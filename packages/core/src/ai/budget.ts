/**
 * The reserve/settle/void/expire budget state machine, as a pure
 * transition function over rows (design.md — "Cost enforcement, in the
 * same path that builds the call"). Mirrors the single conditional
 * `UPDATE ... RETURNING` used by `packages/db/src/ai/ledger.ts` (Phase
 * 11): zero rows returned there is `reserve` refusing here.
 *
 * Expiry is computed at admission and never swept (D4): a reservation
 * past its `expiresAt` is simply excluded from the outstanding sum by
 * `outstandingMicroUsd`, and nothing here mutates its row.
 *
 * Overspend bound (D3, open item proven by `budget.test.ts`): the actual
 * cost of a completed call can exceed its reservation — `settle` records
 * that truthfully rather than retroactively correcting it. The bound
 * lands on the *next* admission: a caller must pass the budget period's
 * already-updated `settledMicroUsd` for that admission to see it.
 */
import { err, ok, type Result } from '../result';

export type ReservationState = 'reserved' | 'settled' | 'voided';

export interface Reservation {
  readonly id: string;
  readonly state: ReservationState;
  readonly reservedMicroUsd: number;
  readonly expiresAt: string;
  readonly actualMicroUsd?: number;
}

export interface BudgetPeriod {
  readonly settledMicroUsd: number;
  readonly limitMicroUsd: number;
}

export interface AdmissionInput {
  readonly reserveMicroUsd: number;
  readonly nowIso: string;
  readonly expiresAtIso: string;
}

export interface BudgetRefusal {
  readonly reason: 'over-budget';
  readonly limitMicroUsd: number;
  readonly outstandingMicroUsd: number;
}

export type VoidReason = 'aborted' | 'error';

/**
 * Sum of every still-live reservation (`state === 'reserved'` AND not yet
 * expired at `nowIso`). A crashed reservation self-heals here — it drops
 * out of this sum the instant `nowIso` passes its `expiresAt`, with no
 * sweeper job and no mutation of the row.
 */
export function outstandingMicroUsd(reservations: readonly Reservation[], nowIso: string): number {
  return reservations
    .filter((r) => r.state === 'reserved' && r.expiresAt > nowIso)
    .reduce((sum, r) => sum + r.reservedMicroUsd, 0);
}

/**
 * Admits a new reservation only when `settled + reserve + outstanding`
 * stays at or under the period's limit — the same inequality as the
 * single conditional `UPDATE` in `design.md`. Refuses otherwise, naming
 * the limit and the outstanding total that caused the refusal.
 */
export function reserve(
  period: BudgetPeriod,
  existing: readonly Reservation[],
  input: AdmissionInput,
  newReservationId: string,
): Result<Reservation, BudgetRefusal> {
  const outstanding = outstandingMicroUsd(existing, input.nowIso);
  const projected = period.settledMicroUsd + input.reserveMicroUsd + outstanding;

  if (projected > period.limitMicroUsd) {
    return err({ reason: 'over-budget', limitMicroUsd: period.limitMicroUsd, outstandingMicroUsd: outstanding });
  }

  return ok({
    id: newReservationId,
    state: 'reserved',
    reservedMicroUsd: input.reserveMicroUsd,
    expiresAt: input.expiresAtIso,
  });
}

/**
 * `WHERE state = 'reserved'` guard, expressed as a pure no-op: settling
 * anything other than a live reservation returns the row unchanged, so a
 * double-settle (e.g. a duplicate `onFinish`) never overwrites a recorded
 * actual cost.
 */
export function settle(reservation: Reservation, actualMicroUsd: number): Reservation {
  if (reservation.state !== 'reserved') {
    return reservation;
  }

  return { ...reservation, state: 'settled', actualMicroUsd };
}

/** Same idempotence guard as `settle`, for the abort/error path. */
export function voidReservation(reservation: Reservation, _reason: VoidReason): Reservation {
  if (reservation.state !== 'reserved') {
    return reservation;
  }

  return { id: reservation.id, state: 'voided', reservedMicroUsd: reservation.reservedMicroUsd, expiresAt: reservation.expiresAt };
}
