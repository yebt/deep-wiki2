/**
 * SMTP `MailSender` adapter (mail-delivery spec):
 *  - satisfies the `MailSender` port contract with no framework type
 *    leaking into `packages/core` (structural, compile-time check below)
 *  - a connection failure is logged without the plaintext SMTP password
 *  - a message sent through the adapter lands in Mailpit's inbox
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import type { MailSender } from '@deep-wiki/core';
import {
  deleteAllMailpitMessages,
  getMailpitMessageText,
  listMailpitMessages,
} from '../../../testing/mailpit-client';
import { ensureTestServices, MAILPIT_SMTP_HOST, MAILPIT_SMTP_PORT } from '../../../testing/services';
import { SmtpMailSender } from './smtp-mail-sender';

interface CapturedLog {
  readonly event: string;
  readonly fields: Record<string, unknown>;
}

class CapturingLogger {
  readonly calls: CapturedLog[] = [];
  info(event: string, fields: Record<string, unknown>): void {
    this.calls.push({ event, fields });
  }
}

// Compile-time contract proof: SmtpMailSender must satisfy MailSender
// exactly as declared in packages/core, with no nodemailer type required
// by the port itself.
const _typeContract: MailSender = new SmtpMailSender({ host: 'localhost', from: 'noreply@example.com' });
void _typeContract;

describe('SmtpMailSender — connection failure', () => {
  test('logs a connection failure without the plaintext SMTP password', async () => {
    const logger = new CapturingLogger();
    const secretPassword = 'super-secret-smtp-password';
    // Port 1 is a reserved, unlisted port — connecting there fails fast
    // without needing a real unreachable-host DNS timeout.
    const sender = new SmtpMailSender(
      { host: 'localhost', port: 1, user: 'someone', password: secretPassword, from: 'noreply@example.com' },
      logger,
    );

    const result = await sender.send({ to: 'someone@example.com', subject: 'test', body: 'body' });

    expect(result.ok).toBe(false);
    expect(logger.calls.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(logger.calls);
    expect(serialised).not.toContain(secretPassword);
  });
});

describe('SmtpMailSender — Mailpit', () => {
  beforeAll(async () => {
    await ensureTestServices();
    await deleteAllMailpitMessages();
  }, 120_000);

  test('a message sent through the adapter is retrievable from Mailpit inbox', async () => {
    const sender = new SmtpMailSender({ host: MAILPIT_SMTP_HOST, port: MAILPIT_SMTP_PORT, from: 'noreply@deep-wiki.local' });
    const uniqueSubject = `deep-wiki test ${crypto.randomUUID()}`;

    const result = await sender.send({
      to: 'recipient@example.com',
      subject: uniqueSubject,
      body: 'This is the invitation body.',
    });

    expect(result.ok).toBe(true);

    const messages = await listMailpitMessages();
    const match = messages.find((m) => m.Subject === uniqueSubject);
    expect(match).toBeDefined();
    expect(match!.To[0]!.Address).toBe('recipient@example.com');

    const text = await getMailpitMessageText(match!.ID);
    expect(text).toContain('This is the invitation body.');
  });
});
