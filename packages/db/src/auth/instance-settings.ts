/**
 * Instance-wide registration policy (design.md — "Registration mode";
 * registration-policy spec). One singleton row, `id = 1`.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export type RegistrationMode = 'closed' | 'invitation_only' | 'open';

export interface InstanceSettings {
  readonly registrationMode: RegistrationMode;
  readonly openRegistrationDomains: readonly string[];
  readonly smtpVerifiedAt: Date | null;
}

interface InstanceSettingsRow {
  registration_mode: RegistrationMode;
  open_registration_domains: string[];
  smtp_verified_at: Date | null;
  smtp_config_hash: string | null;
}

/**
 * Reads the singleton row, reconciling it first: if SMTP was verified
 * against a configuration that no longer matches `currentSmtpConfigHash`,
 * the verification and any `open` mode are reverted to `invitation_only`
 * — design.md: "a verified-once flag over a since-changed configuration
 * is exactly the silent failure the rule exists to stop". `reverted` is
 * `true` only on the read that observes the mismatch, so the caller can
 * log exactly one operator notice.
 */
export async function getInstanceSettings(
  sql: postgres.Sql,
  currentSmtpConfigHash: string,
): Promise<InstanceSettings & { reverted: boolean }> {
  return sql.begin(async (tx) => {
    const [row] = await tx<InstanceSettingsRow[]>`
      SELECT registration_mode, open_registration_domains, smtp_verified_at, smtp_config_hash
        FROM instance_settings
       WHERE id = 1
       FOR UPDATE
    `;
    const settings = row!;

    if (settings.smtp_verified_at && settings.smtp_config_hash !== currentSmtpConfigHash) {
      // Only `open` mode is gated by SMTP verification, so only `open`
      // needs reverting; an explicit `closed` or `invitation_only` choice
      // is untouched by a stale SMTP fingerprint.
      const revertedMode: RegistrationMode = settings.registration_mode === 'open' ? 'invitation_only' : settings.registration_mode;
      await tx`
        UPDATE instance_settings
           SET registration_mode = ${revertedMode}, smtp_verified_at = NULL, smtp_config_hash = NULL
         WHERE id = 1
      `;
      return {
        registrationMode: revertedMode,
        openRegistrationDomains: settings.open_registration_domains,
        smtpVerifiedAt: null,
        reverted: true,
      };
    }

    return {
      registrationMode: settings.registration_mode,
      openRegistrationDomains: settings.open_registration_domains,
      smtpVerifiedAt: settings.smtp_verified_at,
      reverted: false,
    };
  });
}

export async function recordSmtpVerification(sql: SqlExecutor, configHash: string): Promise<void> {
  await sql`UPDATE instance_settings SET smtp_verified_at = now(), smtp_config_hash = ${configHash} WHERE id = 1`;
}

export type SetRegistrationModeResult = 'ok' | 'smtp_not_verified';

export async function setRegistrationMode(
  sql: postgres.Sql,
  mode: RegistrationMode,
  currentSmtpConfigHash: string,
): Promise<SetRegistrationModeResult> {
  // Reconcile unconditionally — not just when the target mode is `open` —
  // so a stale SMTP verification is always cleared before any other
  // change lands, exactly as it would be on a plain read.
  const settings = await getInstanceSettings(sql, currentSmtpConfigHash);

  if (mode === 'open' && !settings.smtpVerifiedAt) {
    return 'smtp_not_verified';
  }

  await sql`UPDATE instance_settings SET registration_mode = ${mode} WHERE id = 1`;
  return 'ok';
}

export async function setOpenRegistrationDomains(sql: SqlExecutor, domains: readonly string[]): Promise<void> {
  await sql`UPDATE instance_settings SET open_registration_domains = ${sql.array([...domains])} WHERE id = 1`;
}
