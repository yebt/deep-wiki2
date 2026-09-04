/**
 * Minimal client for Mailpit's REST API (test-only — used to prove
 * mail-delivery spec's "Development Binding to Mailpit" scenario: a
 * message sent through the SMTP adapter is retrievable from the inbox).
 */
import { MAILPIT_HTTP_BASE_URL } from './services';

export interface MailpitMessageSummary {
  readonly ID: string;
  readonly To: ReadonlyArray<{ Address: string }>;
  readonly Subject: string;
}

interface MailpitMessagesResponse {
  readonly messages: MailpitMessageSummary[];
}

export async function listMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT_HTTP_BASE_URL}/api/v1/messages`);
  if (!res.ok) {
    throw new Error(`mailpit: GET /api/v1/messages failed with ${res.status}`);
  }
  const body = (await res.json()) as MailpitMessagesResponse;
  return body.messages;
}

export async function deleteAllMailpitMessages(): Promise<void> {
  const res = await fetch(`${MAILPIT_HTTP_BASE_URL}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`mailpit: DELETE /api/v1/messages failed with ${res.status}`);
  }
}

export async function getMailpitMessageText(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT_HTTP_BASE_URL}/api/v1/message/${id}`);
  if (!res.ok) {
    throw new Error(`mailpit: GET /api/v1/message/${id} failed with ${res.status}`);
  }
  const body = (await res.json()) as { Text?: string };
  return body.Text ?? '';
}
