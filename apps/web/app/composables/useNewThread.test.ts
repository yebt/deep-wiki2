import { describe, expect, test, vi } from 'vitest';
import { useNewThread, type NewThreadTarget } from './useNewThread';

/**
 * The composer's state machine, apart from any markup: closed → composing
 * → posting → closed on success, or → failed with the text kept. What
 * the person typed is never lost by the machine (docs/UI-CHECKLIST.md §3,
 * "Error — fatal … preserves any unsaved user input").
 */
const target: NewThreadTarget = { blockId: 'd:0123456789ab#0', quote: null, excerpt: 'The block.' };

describe('useNewThread', () => {
  test('starts closed, opens on begin with the target, and cancel clears everything', () => {
    const create = vi.fn();
    const composer = useNewThread({ create });

    expect(composer.status.value).toBe('closed');
    expect(composer.target.value).toBeNull();

    composer.begin(target);
    expect(composer.status.value).toBe('composing');
    expect(composer.target.value).toEqual(target);

    composer.body.value = 'draft';
    composer.cancel();
    expect(composer.status.value).toBe('closed');
    expect(composer.body.value).toBe('');
    expect(composer.target.value).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test('begin while composing retargets and keeps the draft; begin while posting is ignored', async () => {
    let resolvePost!: (value: { ok: true; blockId: string }) => void;
    const create = vi.fn(() => new Promise<{ ok: true; blockId: string }>((resolve) => (resolvePost = resolve)));
    const composer = useNewThread({ create });

    composer.begin(target);
    composer.body.value = 'kept';
    composer.begin({ ...target, blockId: 'other' });
    expect(composer.target.value?.blockId).toBe('other');
    expect(composer.body.value).toBe('kept');

    const posting = composer.post();
    expect(composer.status.value).toBe('posting');
    composer.begin({ ...target, blockId: 'third' });
    expect(composer.target.value?.blockId).toBe('other');
    resolvePost({ ok: true, blockId: 'other' });
    await posting;
  });

  test('post sends the target, the trimmed body and the mentioned ids, and closes on success', async () => {
    const create = vi.fn(async () => ({ ok: true as const, blockId: 'MINTED0001' }));
    const composer = useNewThread({ create });
    composer.begin({ ...target, quote: 'selected words' });
    composer.body.value = '  Looks wrong to me.  ';
    composer.mentions.value = [{ id: 'u1', label: 'Ana' }];

    const ok = await composer.post();

    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({
      blockId: 'd:0123456789ab#0',
      quote: 'selected words',
      excerpt: 'The block.',
      body: 'Looks wrong to me.',
      mentionedUserIds: [],
    });
    expect(composer.status.value).toBe('closed');
    expect(composer.body.value).toBe('');
    expect(composer.mentions.value).toEqual([]);
  });

  test('mentioned ids are the confirmed mentions still named in the body', async () => {
    const create = vi.fn<(input: { mentionedUserIds: readonly string[] }) => Promise<{ ok: boolean; blockId?: string }>>(async () => ({ ok: true, blockId: 'x' }));
    const composer = useNewThread({ create });
    composer.begin(target);
    composer.body.value = 'cc @Ana Lima';
    composer.mentions.value = [
      { id: 'u1', label: 'Ana Lima' },
      { id: 'u2', label: 'Ben' },
    ];
    await composer.post();
    expect(create.mock.calls[0]![0]!.mentionedUserIds).toEqual(['u1']);
  });

  test('an empty body does not post', async () => {
    const create = vi.fn();
    const composer = useNewThread({ create });
    composer.begin(target);
    composer.body.value = '   ';

    expect(await composer.post()).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(composer.status.value).toBe('composing');
    expect(composer.canPost.value).toBe(false);
  });

  test('a failed post keeps the composer open with the text preserved, and a retry posts the same text', async () => {
    const create = vi.fn<() => Promise<{ ok: boolean; blockId?: string }>>().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, blockId: 'x' });
    const composer = useNewThread({ create });
    composer.begin(target);
    composer.body.value = 'Not lost.';

    expect(await composer.post()).toBe(false);
    expect(composer.status.value).toBe('failed');
    expect(composer.body.value).toBe('Not lost.');
    expect(composer.target.value).toEqual(target);

    expect(await composer.post()).toBe(true);
    expect(composer.status.value).toBe('closed');
  });
});
