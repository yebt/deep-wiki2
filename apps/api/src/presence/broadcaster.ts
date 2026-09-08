/**
 * The in-memory `PresenceBroadcaster` adapter (versioning-and-collaboration
 * design.md Decision 5, "Multiple API processes"). A plain
 * `Map<workspaceId, Set<Subscriber>>`: correct and immediate within one
 * process, silent across two. Correctness never depends on this alone —
 * the SSE route (`apps/api/src/routes/presence.ts`) also polls the
 * `presence` view on every keep-alive tick, so an editor on a different
 * process degrades to bounded latency here, never to silence.
 */
import type { PresenceBroadcaster, PresenceEvent, PresenceSubscriber } from '@deep-wiki/core';

export class InMemoryPresenceBroadcaster implements PresenceBroadcaster {
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
