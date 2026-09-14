import { describe, expect, test, vi } from 'vitest';
import { useCreateWorkspace } from './useCreateWorkspace';

function responseError(status: number, data?: unknown) {
  return { response: { status }, data };
}

const created = { workspaceId: 'ws-1', rootNodeId: 'root-1' };

describe('useCreateWorkspace', () => {
  test('a valid request creates the workspace and lands in success carrying its ids', async () => {
    const post = vi.fn(async () => created);
    const { status, workspace, create } = useCreateWorkspace(post);

    expect(status.value).toBe('idle');
    await create({ name: 'Acme Handbook', slug: 'acme-handbook' });

    expect(status.value).toBe('success');
    expect(workspace.value).toEqual(created);
    expect(post).toHaveBeenCalledWith({ name: 'Acme Handbook', slug: 'acme-handbook' });
  });

  test('a plan-limit refusal is its own state carrying the plan name and the number', async () => {
    const post = vi.fn(async () => {
      throw responseError(403, { error: 'limit', reason: 'plan_limit', planName: 'team', maxWorkspaces: 3 });
    });
    const { status, limit, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'acme' });

    expect(status.value).toBe('plan-limit');
    expect(limit.value).toEqual({ planName: 'team', maxWorkspaces: 3 });
  });

  test('a no-plan refusal is its own state, distinct from the limit', async () => {
    const post = vi.fn(async () => {
      throw responseError(403, { error: 'no plan', reason: 'no_plan' });
    });
    const { status, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'acme' });

    expect(status.value).toBe('no-plan');
  });

  test('a taken slug is a field-level state so the form can keep what was typed', async () => {
    const post = vi.fn(async () => {
      throw responseError(409, { error: 'taken', reason: 'slug_taken' });
    });
    const { status, message, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'acme' });

    expect(status.value).toBe('slug-taken');
    expect(message.value).toMatch(/already/i);
  });

  test('a malformed slug is refused before any request is made', async () => {
    const post = vi.fn(async () => created);
    const { status, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'Not A Slug' });

    expect(status.value).toBe('invalid');
    expect(post).not.toHaveBeenCalled();
  });

  test('a 401 is its own state, so the screen offers sign-in rather than a retry', async () => {
    const post = vi.fn(async () => {
      throw responseError(401);
    });
    const { status, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'acme' });

    expect(status.value).toBe('unauthenticated');
  });

  test('an unreachable server is a recoverable error carrying a message the user can act on', async () => {
    const post = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'acme' });

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
  });

  test('a 403 whose body names no known reason is the recoverable error, never a silent success', async () => {
    const post = vi.fn(async () => {
      throw responseError(403, { error: 'forbidden' });
    });
    const { status, create } = useCreateWorkspace(post);

    await create({ name: 'Acme', slug: 'acme' });

    expect(status.value).toBe('network-error');
  });
});
