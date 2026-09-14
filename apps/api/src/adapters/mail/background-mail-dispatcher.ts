/**
 * Mail that is *handed off*, not *awaited* (design.md — "Account
 * non-disclosure"; mail-delivery spec).
 *
 * The password-reset route promises that nothing in its response
 * distinguishes an existing account from an unknown one. The body already
 * kept that promise; the duration did not. A hit ran
 * `await mailSender.send(...)` inside the request — one unpooled SMTP
 * connect, EHLO, optional STARTTLS, MAIL/RCPT/DATA — while a miss ran a
 * SHA-256 and one `DELETE`. Measured against this repository's own local
 * Mailpit, on the same host and without TLS, that is 13.6 ms against
 * 0.0898 ms; a real relay costs 100 ms to 1 s, and a dead one costs the
 * transport's full 5 s `connectionTimeout`. At that point the oracle the
 * body refuses to be is readable with a stopwatch.
 *
 * A `MailDispatcher` cannot be awaited: `dispatch` returns `void`. That is
 * the point — the guarantee is carried by the *type*, not by a reviewer
 * noticing a missing `await`. A route holding one of these has nothing to
 * wait on, so the mail transport cannot enter its response latency at all.
 *
 * The cost of a hand-off is that the send's outcome no longer reaches the
 * caller, so this class is the thing that must not swallow it: every
 * failure — a returned `err` *and* a thrown rejection — is logged as one
 * operator-visible `mail_dispatch_failed` line, and nothing escapes as an
 * unhandled rejection (which would take the process down).
 */
import type { MailSender, SendMailInput } from '@deep-wiki/core';

export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
};

export interface MailDispatcher {
  /**
   * Accepts a message for delivery and returns immediately. `purpose`
   * names the flow the message belongs to (`password_reset`, …) so a
   * failure line says which feature stopped working, and returns `void`
   * so no caller can make its own latency depend on the transport.
   */
  dispatch(purpose: string, input: SendMailInput): void;
}

export class BackgroundMailDispatcher implements MailDispatcher {
  readonly #sender: MailSender;
  readonly #logger: Logger;
  readonly #inFlight = new Set<Promise<void>>();

  constructor(sender: MailSender, logger: Logger = consoleLogger) {
    this.#sender = sender;
    this.#logger = logger;
  }

  dispatch(purpose: string, input: SendMailInput): void {
    const settled = this.#deliver(purpose, input);
    this.#inFlight.add(settled);
    void settled.finally(() => this.#inFlight.delete(settled));
  }

  async #deliver(purpose: string, input: SendMailInput): Promise<void> {
    // Nothing of the send — not even the synchronous head of it — runs in
    // the caller's tick, so a transport that blocks while connecting
    // cannot be charged to the request that dispatched the message.
    await Promise.resolve();

    let failure: string | undefined;
    try {
      const result = await this.#sender.send(input);
      if (!result.ok) {
        failure = result.error.reason;
      }
    } catch {
      // A `MailSender` is not supposed to throw; one that does must still
      // not become an unhandled rejection. The error object itself is
      // never logged — some transports embed a connection URL carrying
      // credentials (see `smtp-mail-sender.ts`).
      failure = 'the mail sender threw';
    }

    if (failure !== undefined) {
      try {
        this.#logFailure(purpose, input, failure);
      } catch {
        // A logger that throws is the one remaining way this promise could
        // reject, and this class exists so that nothing here can.
      }
    }
  }

  /**
   * The recipient is deliberately part of this line. It is not the
   * `login_attempt` case: nothing an attacker submits reaches here, only
   * a message the application genuinely decided to send, and an operator
   * answering "the reset mail never arrived" has no other way to tell
   * whether it was attempted.
   */
  #logFailure(purpose: string, input: SendMailInput, reason: string): void {
    this.#logger.info('mail_dispatch_failed', { purpose, to: input.to, reason });
  }

  /**
   * Resolves once every dispatched message has settled. For tests and for
   * a graceful shutdown that would otherwise drop mail already accepted —
   * never for a request handler, which is the whole point of this class.
   */
  async whenIdle(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.all([...this.#inFlight]);
    }
  }
}
