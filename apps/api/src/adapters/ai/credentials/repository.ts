/**
 * The one module allowed to call the cipher's `open` (rule 7 — design.md
 * — "Extending query-boundaries.ts"). Owns `workspace_ai_credentials`
 * persistence: sealing on save, and the single decryption point a future
 * gateway call (Phase 12) reads through.
 *
 * A credential row's id is fixed before sealing so the AAD
 * (`workspace_id ‖ credential_id ‖ provider`, D7) matches the row it is
 * about to be written into — an update reuses the existing row's id
 * rather than generating a new one, so re-saving a credential never
 * changes the AAD its ciphertext was bound to for no reason.
 */
import { type CredentialCipher, type ProviderId, Secret, type Result, ok, err } from '@deep-wiki/core';
import type postgres from 'postgres';

export interface SaveCredentialInput {
  readonly workspaceId: string;
  readonly provider: ProviderId;
  readonly apiKey: Secret<string>;
  readonly lastFour: string;
  readonly validatedAt: string;
}

export interface SavedCredential {
  readonly id: string;
  readonly lastFour: string;
}

export interface CredentialSummary {
  readonly provider: ProviderId;
  readonly lastFour: string;
  readonly validatedAt: string | null;
}

export interface RepositoryError {
  readonly reason: string;
}

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

/**
 * Seals `input.apiKey` and persists it under `(workspaceId, provider)`,
 * updating in place when a credential for that pair already exists
 * (`UNIQUE (workspace_id, provider)`, 0017_ai_settings_and_credentials.sql).
 */
export async function saveCredential(
  sql: SqlExecutor,
  cipher: CredentialCipher,
  input: SaveCredentialInput,
): Promise<Result<SavedCredential, RepositoryError>> {
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM workspace_ai_credentials WHERE workspace_id = ${input.workspaceId} AND provider = ${input.provider}
  `;
  const id = existing?.id ?? crypto.randomUUID();

  const sealed = await cipher.seal(input.apiKey, {
    workspaceId: input.workspaceId,
    credentialId: id,
    provider: input.provider,
  });
  if (!sealed.ok) {
    return err({ reason: `failed to seal credential: ${sealed.error.reason}` });
  }

  const { ciphertext, iv, authTag, wrappedDek, keyId } = sealed.value;

  await sql`
    INSERT INTO workspace_ai_credentials
      (id, workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four, validated_at, validation_error_code)
    VALUES
      (${id}, ${input.workspaceId}, ${input.provider}, ${Buffer.from(ciphertext)}, ${Buffer.from(iv)}, ${Buffer.from(authTag)},
       ${Buffer.from(wrappedDek)}, ${keyId}, ${input.lastFour}, ${input.validatedAt}, NULL)
    ON CONFLICT (id) DO UPDATE SET
      ciphertext = excluded.ciphertext,
      iv = excluded.iv,
      auth_tag = excluded.auth_tag,
      wrapped_dek = excluded.wrapped_dek,
      key_id = excluded.key_id,
      last_four = excluded.last_four,
      validated_at = excluded.validated_at,
      validation_error_code = NULL,
      compromised_at = NULL,
      updated_at = now()
  `;

  return ok({ id, lastFour: input.lastFour });
}

/** Never selects `ciphertext`/`iv`/`auth_tag`/`wrapped_dek`/`key_id` — the settings-read boundary (workspace-ai-credentials spec). */
export async function listCredentialSummaries(sql: SqlExecutor, workspaceId: string): Promise<readonly CredentialSummary[]> {
  const rows = await sql<{ provider: ProviderId; last_four: string; validated_at: Date | null }[]>`
    SELECT provider, last_four, validated_at FROM workspace_ai_credentials WHERE workspace_id = ${workspaceId} ORDER BY provider
  `;

  return rows.map((row) => ({
    provider: row.provider,
    lastFour: row.last_four,
    validatedAt: row.validated_at ? row.validated_at.toISOString() : null,
  }));
}

/**
 * The single decryption point (rule 7). Consumed by the gateway (Phase
 * 12) at admission time — never before a reservation succeeds.
 */
export async function openCredential(
  sql: SqlExecutor,
  cipher: CredentialCipher,
  workspaceId: string,
  provider: ProviderId,
): Promise<Result<Secret<string>, RepositoryError>> {
  const [row] = await sql<
    { id: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer; wrapped_dek: Buffer; key_id: string }[]
  >`
    SELECT id, ciphertext, iv, auth_tag, wrapped_dek, key_id
    FROM workspace_ai_credentials
    WHERE workspace_id = ${workspaceId} AND provider = ${provider}
  `;
  if (!row) {
    return err({ reason: `no credential stored for provider "${provider}"` });
  }

  const opened = await cipher.open(
    {
      ciphertext: new Uint8Array(row.ciphertext),
      iv: new Uint8Array(row.iv),
      authTag: new Uint8Array(row.auth_tag),
      wrappedDek: new Uint8Array(row.wrapped_dek),
      keyId: row.key_id,
    },
    { workspaceId, credentialId: row.id, provider },
  );
  if (!opened.ok) {
    return err({ reason: `failed to open credential: ${opened.error.reason}` });
  }

  return ok(opened.value);
}
