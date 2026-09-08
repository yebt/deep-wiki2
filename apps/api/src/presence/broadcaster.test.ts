/**
 * `InMemoryPresenceBroadcaster` satisfies the `PresenceBroadcaster` port
 * contract from `packages/core` (versioning-and-collaboration design.md
 * Decision 5, "Multiple API processes"): an in-memory `Map<workspaceId,
 * Set<Subscriber>>`, correct within one process, and — by design — silent
 * across two, which is why the SSE route never depends on it alone.
 */
import { describe, expect, test } from 'bun:test';
import type { PresenceEvent } from '@deep-wiki/core';
import { InMemoryPresenceBroadcaster } from './broadcaster';

describe('InMemoryPresenceBroadcaster', () => {
  test('a subscriber receives an event published to its own workspace', () => {
    const broadcaster = new InMemoryPresenceBroadcaster();
    const received: PresenceEvent[] = [];
    broadcaster.subscribe('ws-1', (event) => received.push(event));

    broadcaster.publish({ workspaceId: 'ws-1', pageId: 'page-1', userId: 'user-1', since: '2026-01-01T00:00:00.000Z' });

    expect(received).toHaveLength(1);
    expect(received[0]?.pageId).toBe('page-1');
  });

  test('a subscriber never receives an event published to a different workspace', () => {
    const broadcaster = new InMemoryPresenceBroadcaster();
    const received: PresenceEvent[] = [];
    broadcaster.subscribe('ws-1', (event) => received.push(event));

    broadcaster.publish({ workspaceId: 'ws-2', pageId: 'page-1', userId: 'user-1', since: '2026-01-01T00:00:00.000Z' });

    expect(received).toHaveLength(0);
  });

  test('unsubscribing stops further delivery to that subscriber, leaving others in the same workspace unaffected', () => {
    const broadcaster = new InMemoryPresenceBroadcaster();
    const first: PresenceEvent[] = [];
    const second: PresenceEvent[] = [];
    const unsubscribeFirst = broadcaster.subscribe('ws-1', (event) => first.push(event));
    broadcaster.subscribe('ws-1', (event) => second.push(event));
    unsubscribeFirst();

    broadcaster.publish({ workspaceId: 'ws-1', pageId: 'page-1', userId: 'user-1', since: '2026-01-01T00:00:00.000Z' });

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });
});
