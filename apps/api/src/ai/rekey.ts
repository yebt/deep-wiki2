/**
 * Key rotation as a re-wrap job (design.md — "Credentials: envelope
 * encryption a self-hoster can operate" — "Rotation"; D5). Per row:
 * unwrap the DEK under its current `key_id`, rewrap under the target,
 * persist only `wrapped_dek`/`key_id` — `ciphertext`, `iv` and
 * `auth_tag` never change (`rewrapDek`, Phase 7.5/7.6). A row already at
 * the target is skipped, which is what makes the job idempotent and
 * resumable: a failed row halts before touching later rows, and
 * re-running with the same `--to` picks up exactly where it stopped.
 *
 * `--compromised` marks only the rows this run actually moves off their
 * current key: those are exactly the rows that were wrapped under the
 * (now-compromised) key being rotated away from. A row already at the
 * target never had anything to do with the compromised key and is left
 * untouched by the compromise flag as well as by the rewrap itself.
 */
import { err, ok, type KeyProvider, type Result } from '@deep-wiki/core';
import type postgres from 'postgres';
import { rewrapDek } from '../adapters/ai/key-provider/env-key-provider';

export interface RekeyDeps {
  readonly sql: postgres.Sql;
  readonly keyProvider: KeyProvider;
}

export interface RekeyOptions {
  readonly toKeyId: string;
  /** Design.md — "Rotation is not revocation": stamps `compromised_at` and clears `validated_at` on every row this run rewraps. */
  readonly compromised?: boolean;
}

export interface RekeyRowOutcome {
  readonly id: string;
  readonly skipped: boolean;
}

export interface RekeyError {
  readonly reason: string;
}

export async function rekeyAll(deps: RekeyDeps, options: RekeyOptions): Promise<Result<readonly RekeyRowOutcome[], RekeyError>> {
  const rows = await deps.sql<{ id: string; wrapped_dek: Buffer; key_id: string }[]>`
    SELECT id, wrapped_dek, key_id FROM workspace_ai_credentials ORDER BY id
  `;

  const outcomes: RekeyRowOutcome[] = [];

  for (const row of rows) {
    if (row.key_id === options.toKeyId) {
      outcomes.push({ id: row.id, skipped: true });
      continue;
    }

    const rewrapped = await rewrapDek(deps.keyProvider, new Uint8Array(row.wrapped_dek), row.key_id, options.toKeyId);
    if (!rewrapped.ok) {
      return err({ reason: `failed to rewrap credential ${row.id}: ${rewrapped.error.reason}` });
    }

    if (options.compromised) {
      await deps.sql`
        UPDATE workspace_ai_credentials
           SET wrapped_dek = ${Buffer.from(rewrapped.value)}, key_id = ${options.toKeyId},
               compromised_at = now(), validated_at = NULL, updated_at = now()
         WHERE id = ${row.id}
      `;
    } else {
      await deps.sql`
        UPDATE workspace_ai_credentials
           SET wrapped_dek = ${Buffer.from(rewrapped.value)}, key_id = ${options.toKeyId}, updated_at = now()
         WHERE id = ${row.id}
      `;
    }

    outcomes.push({ id: row.id, skipped: false });
  }

  return ok(outcomes);
}
