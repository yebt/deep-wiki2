import { describe, expect, test, vi } from 'vitest';
import { useMentionCandidates } from './useMentionCandidates';

describe('useMentionCandidates', () => {
  test('search merges pages and subjects into one candidate list', async () => {
    const fetchPages = vi.fn(async () => ({ pages: [{ id: 'p1', title: 'Handbook' }] }));
    const fetchSubjects = vi.fn(async () => ({ subjects: [{ id: 'u1', displayName: 'Alice' }] }));
    const { search } = useMentionCandidates('ws-1', 'page-1', { fetchPages, fetchSubjects });

    const candidates = await search('a');

    expect(fetchPages).toHaveBeenCalledWith('ws-1', 'a');
    expect(fetchSubjects).toHaveBeenCalledWith('ws-1', 'page-1', 'a');
    expect(candidates).toEqual([
      { id: 'u1', type: 'user', label: 'Alice' },
      { id: 'p1', type: 'page', label: 'Handbook' },
    ]);
  });

  test('an unreadable page or user never appears — trusts the server response as-is, adds nothing client-side', async () => {
    const fetchPages = vi.fn(async () => ({ pages: [] }));
    const fetchSubjects = vi.fn(async () => ({ subjects: [] }));
    const { search } = useMentionCandidates('ws-1', 'page-1', { fetchPages, fetchSubjects });

    expect(await search('secret')).toEqual([]);
  });

  test('checkAccess reports whether the mentioned user can read this page', async () => {
    const checkAccess = vi.fn(async () => ({ canRead: false }));
    const { checkAccess: check } = useMentionCandidates('ws-1', 'page-1', { checkAccess });

    expect(await check('u1')).toBe(false);
    expect(checkAccess).toHaveBeenCalledWith('page-1', 'u1');
  });
});
