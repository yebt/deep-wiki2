/**
 * Port for fanning out editing-presence events within one workspace
 * (versioning-and-collaboration design.md Decision 5, "Multiple API
 * processes"). The in-memory adapter (`apps/api/src/presence/broadcaster.ts`)
 * publishes after `heartbeatLock` succeeds — no second write path, no
 * client loop of its own. An implementation with N processes may degrade
 * to a poll-based fallback (the SSE route's own keep-alive tick); the port
 * itself carries no assumption about process topology.
 */
export interface PresenceEvent {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly userId: string;
  /** ISO timestamp the lock (and therefore the presence) was acquired. */
  readonly since: string;
}

export type PresenceSubscriber = (event: PresenceEvent) => void;

export interface PresenceBroadcaster {
  /** Delivers `event` to every current subscriber of `event.workspaceId`, and no other workspace's subscribers. */
  publish(event: PresenceEvent): void;
  /** Registers `subscriber` for one workspace's events; returns an unsubscribe function. */
  subscribe(workspaceId: string, subscriber: PresenceSubscriber): () => void;
}
