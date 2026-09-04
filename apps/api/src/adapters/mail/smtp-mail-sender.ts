/**
 * SMTP `MailSender` adapter (design.md — "Ports and adapters"): bound to
 * Mailpit in development (port 1025, no auth), configurable SMTP for
 * production. The SMTP password never appears in a log line — the
 * transport's own connection/auth failure is reduced to a bare reason
 * string before logging.
 */
import type { MailSendError, MailSender, Result, SendMailInput } from '@deep-wiki/core';
import { err, ok } from '@deep-wiki/core';
import nodemailer, { type Transporter } from 'nodemailer';

export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
};

export interface SmtpMailSenderConfig {
  readonly host: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly user?: string;
  readonly password?: string;
  readonly from: string;
}

export class SmtpMailSender implements MailSender {
  readonly #transport: Transporter;
  readonly #from: string;
  readonly #logger: Logger;

  constructor(config: SmtpMailSenderConfig, logger: Logger = consoleLogger) {
    this.#from = config.from;
    this.#logger = logger;
    this.#transport = nodemailer.createTransport({
      host: config.host,
      port: config.port ?? 25,
      secure: config.secure ?? false,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 5_000,
    });
  }

  async send(input: SendMailInput): Promise<Result<void, MailSendError>> {
    try {
      await this.#transport.sendMail({
        from: this.#from,
        to: input.to,
        subject: input.subject,
        text: input.body,
      });
      return ok(undefined);
    } catch {
      // Never log the SMTP password, and never log nodemailer's raw error
      // object (some transports embed the connection URL, which can carry
      // credentials) — only a short, human-authored reason.
      this.#logger.info('smtp_send_failed', { reason: 'failed to connect or send via SMTP' });
      return err({ reason: 'failed to send mail' });
    }
  }
}
