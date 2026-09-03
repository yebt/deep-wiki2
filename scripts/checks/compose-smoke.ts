/**
 * Live assertions against a running compose stack (`podman compose up -d
 * --wait` locally, `docker compose up -d --wait` in CI's compose-smoke job).
 * A container reaching "running" is not proof it works — this proves the
 * two integration points the container-stack spec actually cares about:
 *
 *   1. Mailpit: a message sent over SMTP on 1025 is retrievable from the
 *      API on 8025 (container-stack: "Mailpit exposes both interfaces").
 *   2. Kroki + its Mermaid sidecar: a real Mermaid diagram POSTed to Kroki's
 *      HTTP endpoint comes back as a rendered SVG, proving `KROKI_MERMAID_HOST`
 *      actually routes to the sidecar (design.md D8) rather than merely
 *      starting it.
 *
 * Not part of `bun run check` — those checks run with no containers up.
 * Run this after the stack is healthy: `bun run compose:smoke`.
 */
import { connect } from 'node:net';

const MAILPIT_SMTP_HOST = process.env.MAILPIT_SMTP_HOST ?? 'localhost';
const MAILPIT_SMTP_PORT = Number(process.env.MAILPIT_SMTP_PORT ?? 1025);
const MAILPIT_API_BASE = process.env.MAILPIT_API_BASE ?? 'http://localhost:8025';
const KROKI_BASE = process.env.KROKI_BASE ?? 'http://localhost:8000';

interface SmtpMessageOptions {
  host: string;
  port: number;
  from: string;
  to: string;
  subject: string;
  body: string;
}

type SmtpState = 'banner' | 'helo' | 'mail' | 'rcpt' | 'data' | 'body' | 'quit' | 'done';

/**
 * Sends one message via a minimal hand-rolled SMTP dialog (HELO, MAIL FROM,
 * RCPT TO, DATA) — Mailpit accepts unauthenticated plain SMTP, so no
 * library or credentials are needed for this smoke assertion.
 */
export function sendSmtpMessage(options: SmtpMessageOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: options.host, port: options.port });
    let state: SmtpState = 'banner';
    let buffer = '';
    let settled = false;

    const message = [
      `From: ${options.from}`,
      `To: ${options.to}`,
      `Subject: ${options.subject}`,
      '',
      options.body,
    ].join('\r\n');

    function fail(reason: string): void {
      if (settled) return;
      settled = true;
      reject(new Error(reason));
      socket.destroy();
    }

    function succeed(): void {
      if (settled) return;
      settled = true;
      resolve();
    }

    socket.setEncoding('utf8');
    socket.setTimeout(10_000);
    socket.on('timeout', () => fail(`SMTP connection to ${options.host}:${options.port} timed out`));
    socket.on('error', (err) => fail(`SMTP connection error: ${err.message}`));
    socket.on('close', () => {
      if (state === 'done') succeed();
      else fail('SMTP connection closed before the dialog completed');
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.endsWith('\r\n')) return;
      const lines = buffer.trim().split('\r\n');
      buffer = '';
      const last = lines[lines.length - 1] ?? '';
      const code = Number(last.slice(0, 3));

      switch (state) {
        case 'banner':
          if (code !== 220) return fail(`unexpected SMTP banner: ${last}`);
          state = 'helo';
          socket.write('HELO deep-wiki-smoke-test\r\n');
          return;
        case 'helo':
          if (code !== 250) return fail(`HELO rejected: ${last}`);
          state = 'mail';
          socket.write(`MAIL FROM:<${options.from}>\r\n`);
          return;
        case 'mail':
          if (code !== 250) return fail(`MAIL FROM rejected: ${last}`);
          state = 'rcpt';
          socket.write(`RCPT TO:<${options.to}>\r\n`);
          return;
        case 'rcpt':
          if (code !== 250) return fail(`RCPT TO rejected: ${last}`);
          state = 'data';
          socket.write('DATA\r\n');
          return;
        case 'data':
          if (code !== 354) return fail(`DATA rejected: ${last}`);
          state = 'body';
          socket.write(`${message}\r\n.\r\n`);
          return;
        case 'body':
          if (code !== 250) return fail(`message body rejected: ${last}`);
          state = 'quit';
          socket.write('QUIT\r\n');
          return;
        case 'quit':
          state = 'done';
          socket.end();
          return;
        default:
          return;
      }
    });
  });
}

export interface MailpitMessage {
  ID: string;
  Subject: string;
}

export async function findMailpitMessageBySubject(apiBase: string, subject: string): Promise<MailpitMessage | undefined> {
  const response = await fetch(`${apiBase}/api/v1/messages?limit=50`);
  if (!response.ok) {
    throw new Error(`Mailpit API returned ${response.status} from ${apiBase}/api/v1/messages`);
  }
  const body = (await response.json()) as { messages?: MailpitMessage[] };
  return (body.messages ?? []).find((candidate) => candidate.Subject === subject);
}

export function isRenderedSvg(content: string): boolean {
  return content.includes('<svg');
}

export async function renderMermaidViaKroki(base: string, diagram: string): Promise<string> {
  const response = await fetch(`${base}/mermaid/svg`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: diagram,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Kroki returned ${response.status} for a Mermaid render request: ${detail}`);
  }
  return response.text();
}

async function retryUntil<T>(fn: () => Promise<T | undefined>, attempts: number, delayMs: number): Promise<T | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await fn();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return undefined;
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const subject = `deep-wiki-compose-smoke-${Date.now()}`;

  try {
    await sendSmtpMessage({
      host: MAILPIT_SMTP_HOST,
      port: MAILPIT_SMTP_PORT,
      from: 'smoke@deep-wiki.test',
      to: 'owner@deep-wiki.test',
      subject,
      body: 'compose-smoke: SMTP send-then-retrieve assertion.',
    });

    const found = await retryUntil(() => findMailpitMessageBySubject(MAILPIT_API_BASE, subject), 10, 500);
    if (!found) {
      errors.push(`mailpit: message with subject "${subject}" was sent over SMTP but never appeared via the API`);
    }
  } catch (error) {
    errors.push(`mailpit: ${(error as Error).message}`);
  }

  try {
    const svg = await renderMermaidViaKroki(KROKI_BASE, 'graph TD;\n  A-->B;\n');
    if (!isRenderedSvg(svg)) {
      errors.push('kroki: /mermaid/svg response did not contain an <svg> element');
    }
  } catch (error) {
    errors.push(`kroki: ${(error as Error).message}`);
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`compose-smoke: ${err}`);
    }
    process.exit(1);
  }
  console.log('compose-smoke: ok (mailpit send+retrieve, kroki mermaid render)');
}

if (import.meta.main) {
  await main();
}
