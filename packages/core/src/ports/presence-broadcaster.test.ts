/**
 * Port-contract test: any `PresenceBroadcaster` implementation — the
 * in-memory adapter (`apps/api/src/presence/broadcaster.ts`) or a fake
 * used by higher-layer tests — must satisfy this publish/subscribe shape
 * (versioning-and-collaboration design.md Decision 5, "Multiple API
 * processes").
 */
import { describe, expect, test } from 'bun:test';
import type { PresenceBroadcaster, PresenceEvent, PresenceSubscriber } from './presence-broadcaster';

class FakePresenceBroadcaster implements PresenceBroadcaster {
  private readonly subscribersByWorkspace = new Map<string, Set<PresenceSubscriber>>();

  publish(event: PresenceEvent): void {
    for (const subscriber of this.subscribersByWorkspace.get(event.workspaceId) ?? []) {
      subscriber(event);
    }
  }

  subscribe(workspaceId: string, subscriber: PresenceSubscriber): () => void {
    const set = this.subscribersByWorkspace.get(workspaceId) ?? new Set();
    set.add(subscriber);
    this.subscribersByWorkspace.set(workspaceId, set);
    return () => set.delete(subscriber);
  }
}

describe('PresenceBroadcaster port contract', () => {
  test('a subscriber receives an event published to its own workspace', () => {
    const broadcaster: PresenceBroadcaster = new FakePresenceBroadcaster();
    const received: PresenceEvent[] = [];
    broadcaster.subscribe('ws-1', (event) => received.push(event));

    broadcaster.publish({ workspaceId: 'ws-1', pageId: 'page-1', userId: 'user-1', since: '2026-01-01T00:00:00.000Z' });

    expect(received).toHaveLength(1);
    expect(received[0]?.pageId).toBe('page-1');
  });

  test('a subscriber never receives an event published to a different workspace', () => {
    const broadcaster: PresenceBroadcaster = new FakePresenceBroadcaster();
    const received: PresenceEvent[] = [];
    broadcaster.subscribe('ws-1', (event) => received.push(event));

    broadcaster.publish({ workspaceId: 'ws-2', pageId: 'page-1', userId: 'user-1', since: '2026-01-01T00:00:00.000Z' });

    expect(received).toHaveLength(0);
  });

  test('unsubscribing stops further delivery to that subscriber', () => {
    const broadcaster: PresenceBroadcaster = new FakePresenceBroadcaster();
    const received: PresenceEvent[] = [];
    const unsubscribe = broadcaster.subscribe('ws-1', (event) => received.push(event));
    unsubscribe();

    broadcaster.publish({ workspaceId: 'ws-1', pageId: 'page-1', userId: 'user-1', since: '2026-01-01T00:00:00.000Z' });

    expect(received).toHaveLength(0);
  });
});
