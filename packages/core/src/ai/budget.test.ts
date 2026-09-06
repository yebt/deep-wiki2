import { describe, expect, test } from 'bun:test';
import { outstandingMicroUsd, reserve, settle, voidReservation } from './budget';
import type { BudgetPeriod, Reservation } from './budget';

const PERIOD_NOW = '2026-01-01T00:00:00.000Z';
const EXPIRES_AT = '2026-01-01T00:15:00.000Z';

describe('reserve -> settle', () => {
  test('settle releases the reservation and records the actual cost', () => {
    const period: BudgetPeriod = { settledMicroUsd: 0, limitMicroUsd: 10_000 };

    const admission = reserve(period, [], { reserveMicroUsd: 900, nowIso: PERIOD_NOW, expiresAtIso: EXPIRES_AT }, 'r1');
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;

    const settled = settle(admission.value, 850);

    expect(settled.state).toBe('settled');
    expect(settled.actualMicroUsd).toBe(850);
  });

  test('settle is idempotent: settling an already-settled reservation is a no-op', () => {
    const reservation: Reservation = {
      id: 'r1',
      state: 'settled',
      reservedMicroUsd: 900,
      actualMicroUsd: 850,
      expiresAt: EXPIRES_AT,
    };

    const result = settle(reservation, 999);

    expect(result.actualMicroUsd).toBe(850);
    expect(result.state).toBe('settled');
  });
});

describe('reserve -> void', () => {
  test('void releases the reservation with no settlement', () => {
    const period: BudgetPeriod = { settledMicroUsd: 0, limitMicroUsd: 10_000 };

    const admission = reserve(period, [], { reserveMicroUsd: 900, nowIso: PERIOD_NOW, expiresAtIso: EXPIRES_AT }, 'r1');
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;

    const voided = voidReservation(admission.value, 'aborted');

    expect(voided.state).toBe('voided');
    expect(voided.actualMicroUsd).toBeUndefined();
  });

  test('void is idempotent: voiding an already-settled reservation is a no-op', () => {
    const reservation: Reservation = {
      id: 'r1',
      state: 'settled',
      reservedMicroUsd: 900,
      actualMicroUsd: 850,
      expiresAt: EXPIRES_AT,
    };

    const result = voidReservation(reservation, 'aborted');

    expect(result.state).toBe('settled');
  });
});

describe('expiry — excluded from the outstanding sum with no sweep', () => {
  test('a reservation past its expiry is excluded from the outstanding sum', () => {
    const reservations: readonly Reservation[] = [
      { id: 'r1', state: 'reserved', reservedMicroUsd: 500, expiresAt: '2026-01-01T00:00:00.000Z' },
    ];

    const outstanding = outstandingMicroUsd(reservations, '2026-01-01T00:00:01.000Z');

    expect(outstanding).toBe(0);
  });

  test('the crashed reservation itself is left untouched — no sweep mutates it', () => {
    const reservations: readonly Reservation[] = [
      { id: 'r1', state: 'reserved', reservedMicroUsd: 500, expiresAt: '2026-01-01T00:00:00.000Z' },
    ];

    outstandingMicroUsd(reservations, '2026-01-01T00:00:01.000Z');

    expect(reservations[0]!.state).toBe('reserved');
  });

  test('a reservation still within its expiry counts toward the outstanding sum', () => {
    const reservations: readonly Reservation[] = [
      { id: 'r1', state: 'reserved', reservedMicroUsd: 500, expiresAt: '2026-01-01T00:30:00.000Z' },
    ];

    const outstanding = outstandingMicroUsd(reservations, PERIOD_NOW);

    expect(outstanding).toBe(500);
  });
});

describe('admission refuses over budget (design.md — single conditional UPDATE)', () => {
  test('refuses when settled + reserve + outstanding exceeds the limit', () => {
    const period: BudgetPeriod = { settledMicroUsd: 9_500, limitMicroUsd: 10_000 };

    const result = reserve(period, [], { reserveMicroUsd: 600, nowIso: PERIOD_NOW, expiresAtIso: EXPIRES_AT }, 'r1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('over-budget');
      expect(result.error.limitMicroUsd).toBe(10_000);
    }
  });

  test('an outstanding reservation from another in-flight call counts against the next admission', () => {
    const period: BudgetPeriod = { settledMicroUsd: 0, limitMicroUsd: 1_000 };
    const inFlight: readonly Reservation[] = [
      { id: 'r0', state: 'reserved', reservedMicroUsd: 600, expiresAt: EXPIRES_AT },
    ];

    const result = reserve(period, inFlight, { reserveMicroUsd: 500, nowIso: PERIOD_NOW, expiresAtIso: EXPIRES_AT }, 'r1');

    expect(result.ok).toBe(false);
  });
});

describe('under-reservation bound (open item — the design claims a bound, this proves it)', () => {
  test('actual usage above the reservation is recorded truthfully; overspend is bounded to exactly one call', () => {
    const period: BudgetPeriod = { settledMicroUsd: 0, limitMicroUsd: 1_000 };

    // The stream is admitted under budget with a reservation the design
    // treats as an upper bound (maxOutputTokens is required on the call).
    const admission = reserve(period, [], { reserveMicroUsd: 900, nowIso: PERIOD_NOW, expiresAtIso: EXPIRES_AT }, 'r1');
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;

    // The provider under-reported and the actual usage exceeds the reserve.
    const settled = settle(admission.value, 1_500);
    expect(settled.state).toBe('settled');
    expect(settled.actualMicroUsd).toBe(1_500);

    // The overspend is recorded truthfully in the next period snapshot —
    // the completed call was never retroactively corrected or blocked.
    const periodAfterSettlement: BudgetPeriod = { settledMicroUsd: 1_500, limitMicroUsd: 1_000 };

    // The bound holds at exactly the next admission, not before: it is refused.
    const next = reserve(periodAfterSettlement, [], { reserveMicroUsd: 10, nowIso: PERIOD_NOW, expiresAtIso: EXPIRES_AT }, 'r2');

    expect(next.ok).toBe(false);
  });
});
