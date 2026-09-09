/**
 * `PresenceStreamRegistry` — the server-shutdown termination path for the
 * presence SSE route (design.md Decision 5, "Termination"). Distinct from
 * client disconnect (the abort signal each stream registers for itself):
 * this is the mechanism `index.ts` calls on shutdown to close every still
 * open stream rather than leaving connections dangling.
 */
import { describe, expect, test } from 'bun:test';
import { PresenceStreamRegistry } from './registry';

describe('PresenceStreamRegistry', () => {
  test('closeAll closes every currently registered stream', () => {
    const registry = new PresenceStreamRegistry();
    let firstClosed = false;
    let secondClosed = false;
    registry.register(() => {
      firstClosed = true;
    });
    registry.register(() => {
      secondClosed = true;
    });

    registry.closeAll();

    expect(firstClosed).toBe(true);
    expect(secondClosed).toBe(true);
  });

  test('unregistering removes a stream so closeAll never calls it', () => {
    const registry = new PresenceStreamRegistry();
    let closed = false;
    const unregister = registry.register(() => {
      closed = true;
    });
    unregister();

    registry.closeAll();

    expect(closed).toBe(false);
  });
});
