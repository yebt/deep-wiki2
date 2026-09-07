import type { MentionCandidate } from '@deep-wiki/editor';

export type FetchPages = (workspaceId: string, query: string) => Promise<{ pages: { id: string; title: string }[] }>;
export type FetchSubjects = (workspaceId: string, pageId: string, query: string) => Promise<{ subjects: { id: string; displayName: string }[] }>;
export type CheckAccess = (pageId: string, userId: string) => Promise<{ canRead: boolean }>;

export interface UseMentionCandidatesDeps {
  readonly fetchPages?: FetchPages;
  readonly fetchSubjects?: FetchSubjects;
  readonly checkAccess?: CheckAccess;
}

export interface UseMentionCandidatesResult {
  readonly search: (query: string) => Promise<MentionCandidate[]>;
  readonly checkAccess: (userId: string) => Promise<boolean>;
}

/**
 * `GET /mentions/pages` + `GET /mentions/subjects` (document-editor spec:
 * "Mention Autocomplete Is Filtered By can()"). Both endpoints already
 * filter through `can()`/`canManySubjects` server-side
 * (knowledge-graph spec: "Link And Mention Autocomplete Never
 * Discloses") — this composable adds nothing client-side beyond merging
 * the two result sets into one list the mention menu can render; an
 * unreadable candidate never reaches it in the first place. Subjects are
 * always surfaced as `type: 'user'`: `listWorkspaceMemberCandidates`
 * (packages/db) only ever returns users today, not cells, despite the
 * design's broader "user, cell" language — recorded rather than
 * pretending cell mentions already work.
 */
export function useMentionCandidates(workspaceId: string, pageId: string, deps: UseMentionCandidatesDeps = {}): UseMentionCandidatesResult {
  const config = useRuntimeConfig();

  const fetchPages: FetchPages =
    deps.fetchPages ??
    ((ws, query) => $fetch(`${config.public.apiBaseUrl}/mentions/pages`, { credentials: 'include', query: { workspaceId: ws, q: query } }));
  const fetchSubjects: FetchSubjects =
    deps.fetchSubjects ??
    ((ws, page, query) =>
      $fetch(`${config.public.apiBaseUrl}/mentions/subjects`, { credentials: 'include', query: { workspaceId: ws, pageId: page, q: query } }));
  const checkAccessFetcher: CheckAccess =
    deps.checkAccess ??
    ((page, userId) => $fetch(`${config.public.apiBaseUrl}/pages/${page}/mentions/${userId}/check`, { credentials: 'include' }));

  async function search(query: string): Promise<MentionCandidate[]> {
    const [{ subjects }, { pages }] = await Promise.all([fetchSubjects(workspaceId, pageId, query), fetchPages(workspaceId, query)]);
    return [
      ...subjects.map((subject): MentionCandidate => ({ id: subject.id, type: 'user', label: subject.displayName })),
      ...pages.map((page): MentionCandidate => ({ id: page.id, type: 'page', label: page.title })),
    ];
  }

  async function checkAccess(userId: string): Promise<boolean> {
    const result = await checkAccessFetcher(pageId, userId);
    return result.canRead;
  }

  return { search, checkAccess };
}
