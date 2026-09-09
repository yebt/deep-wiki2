import { describe, expect, test, vi } from 'vitest';
import { usePageRead } from './usePageRead';

describe('usePageRead', () => {
  test('starts idle and moves through loading to success with the cached HTML and title', async () => {
    const fetcher = vi.fn(async () => ({ html: '<p>Hello</p>', title: 'Hello' }));
    const { status, html, title, load } = usePageRead('page-1', fetcher);

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(html.value).toBe('<p>Hello</p>');
    expect(title.value).toBe('Hello');
    expect(fetcher).toHaveBeenCalledWith('page-1');
  });

  test('a 403 response resolves to the permission-denied state, not a generic error', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = usePageRead('page-1', fetcher);

    await load();

    expect(status.value).toBe('forbidden');
  });

  test('a 404 response resolves to the not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = usePageRead('page-1', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = usePageRead('page-1', fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { html: '<p>Recovered</p>', title: 'Recovered' };
    });
    const { status, html, load } = usePageRead('page-1', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
    expect(html.value).toBe('<p>Recovered</p>');
  });
});
