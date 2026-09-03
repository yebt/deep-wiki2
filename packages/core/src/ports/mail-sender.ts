import type { Result } from '../result';

/**
 * Port for sending transactional email. Self-hosters need plain SMTP, so
 * this port has no built-in assumption of a SaaS provider (docs/SPECS.md
 * §12.3). Adapters (dev SMTP via Mailpit, production SMTP, transactional
 * API providers) land in Phase 1 — this file defines the interface only.
 */
export interface SendMailInput {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface MailSendError {
  readonly reason: string;
}

export interface MailSender {
  send(input: SendMailInput): Promise<Result<void, MailSendError>>;
}
