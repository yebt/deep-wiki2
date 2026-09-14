/**
 * `BackgroundMailDispatcher` — the hand-off that keeps the SMTP round trip
 * out of a response's latency (`background-mail-dispatcher.ts`). Covers the
 * two properties that make the hand-off safe rather than merely fast:
 * nothing of the send runs in the caller's tick, and no failure is
 * swallowed (neither a returned `err` nor a thrown one, and never as an
 * unhandled rejection).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { err, ok, type MailSendError, type MailSender, type Result, type SendMailInput } from '@deep-wiki/core';
import { BackgroundMailDispatcher, type Logger } from './background-mail-dispatcher';

class CapturingLogger implements Logger {
  readonly calls: Array<{ event: string; fields: Record<string, unknown> }> = [];

  info(event: string, fields: Record<string, unknown>): void {
    this.calls.push({ event, fields });
  }
}

const message: SendMailInput = {
  to: 'someone@example.com',
  subject: 'Reset your password',
  body: 'link',
};

test('dispatch returns before the sender is even entered', () => {
  let entered = false;
  const sender: MailSender = {
    async send(): Promise<Result<void, MailSendError>> {
      entered = true;
      return ok(undefined);
    },
  };

  new BackgroundMailDispatcher(sender, new CapturingLogger()).dispatch('password_reset', message);

  // Synchronously after `dispatch`, no part of the send has run — so no
  // part of its cost can be attributed to the caller's request.
  expect(entered).toBe(false);
});

test('whenIdle resolves only once every dispatched message has settled', async () => {
  const sent: SendMailInput[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sender: MailSender = {
    async send(input): Promise<Result<void, MailSendError>> {
      await gate;
      sent.push(input);
      return ok(undefined);
    },
  };

  const dispatcher = new BackgroundMailDispatcher(sender, new CapturingLogger());
  dispatcher.dispatch('password_reset', message);
  dispatcher.dispatch('password_reset', { ...message, to: 'other@example.com' });

  let idle = false;
  const idleWait = dispatcher.whenIdle().then(() => {
    idle = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(idle).toBe(false);

  release();
  await idleWait;
  expect(sent).toHaveLength(2);
});

test('a returned failure is logged for an operator, naming the purpose and the recipient', async () => {
  const logger = new CapturingLogger();
  const sender: MailSender = {
    async send(): Promise<Result<void, MailSendError>> {
      return err({ reason: 'failed to send mail' });
    },
  };

  const dispatcher = new BackgroundMailDispatcher(sender, logger);
  dispatcher.dispatch('password_reset', message);
  await dispatcher.whenIdle();

  expect(logger.calls).toHaveLength(1);
  expect(logger.calls[0]!.event).toBe('mail_dispatch_failed');
  expect(logger.calls[0]!.fields).toEqual({
    purpose: 'password_reset',
    to: 'someone@example.com',
    reason: 'failed to send mail',
  });
});

describe('a sender that throws', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  test('is logged and never escapes as an unhandled rejection', async () => {
    process.on('unhandledRejection', onUnhandled);
    const logger = new CapturingLogger();
    const sender: MailSender = {
      async send(): Promise<Result<void, MailSendError>> {
        throw new Error('smtp connection refused');
      },
    };

    const dispatcher = new BackgroundMailDispatcher(sender, logger);
    dispatcher.dispatch('password_reset', message);
    await dispatcher.whenIdle();
    // Give the runtime a turn to surface a rejection if one escaped.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(unhandled).toHaveLength(0);
    expect(logger.calls[0]!.event).toBe('mail_dispatch_failed');
    expect(logger.calls[0]!.fields.reason).toBe('the mail sender threw');
    // The thrown error's own text never reaches the log: a transport's
    // error object can embed a connection URL carrying credentials.
    expect(JSON.stringify(logger.calls)).not.toContain('smtp connection refused');
  });
});

test('a logger that throws while reporting a failure does not become an unhandled rejection', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const throwingLogger: Logger = {
      info() {
        throw new Error('log sink unavailable');
      },
    };
    const sender: MailSender = {
      async send(): Promise<Result<void, MailSendError>> {
        return err({ reason: 'failed to send mail' });
      },
    };

    const dispatcher = new BackgroundMailDispatcher(sender, throwingLogger);
    dispatcher.dispatch('password_reset', message);
    await dispatcher.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(unhandled).toHaveLength(0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
