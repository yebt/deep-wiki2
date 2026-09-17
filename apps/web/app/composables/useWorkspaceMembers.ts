/**
 * `GET /workspaces/:id/members` and `POST /invitations` — the members
 * screen's two calls: who is in a workspace and who is invited, and
 * inviting one more person.
 *
 * **A 404 is one state, and it is deliberately ambiguous.** The route
 * answers `not found` both for a workspace that does not exist and for
 * one the caller may not manage (apps/api/src/routes/workspaces.ts),
 * so this composable cannot and does not tell them apart; the screen's
 * copy is written to be true under both readings.
 *
 * **Starting grants are workspace-wide.** An invitation carries one grant
 * on the workspace root — `read`, `comment`, `write` or `manage` — which
 * the resolver inherits down the whole tree. Granting on a single shelf
 * or book is a node picker this screen does not have yet.
 *
 * **Sending reloads.** The route answers `{ ok: true }` and nothing more;
 * the pending row the admin then sees comes from re-reading the listing,
 * which is also what proves the invitation was recorded — a locally
 * appended row would be a guess about the server.
 */
import {
  CreateInvitationRequestSchema,
  type ActionValue,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type WorkspaceMembersResponse,
} from '@deep-wiki/contracts';
import { z } from 'zod';
import { workspaceMembersKey } from '~/utils/api-keys';

export type WorkspaceMembersStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';
export type InviteStatus = 'idle' | 'sending' | 'sent' | 'invalid' | 'not-found' | 'unauthenticated' | 'network-error';

export interface InviteInput {
  readonly email: string;
  readonly action: ActionValue;
}

/** Asked by the workspace's id or, as the members screen does from its address, by its slug (`apps/api/src/routes/workspace-ref.ts`). */
export type FetchWorkspaceMembers = (workspaceRef: string) => Promise<WorkspaceMembersResponse>;
export type PostInvitation = (input: CreateInvitationRequest) => Promise<CreateInvitationResponse>;

export interface UseWorkspaceMembersDeps {
  readonly fetchMembers?: FetchWorkspaceMembers;
  readonly postInvitation?: PostInvitation;
}

export interface UseWorkspaceMembersResult {
  readonly status: Ref<WorkspaceMembersStatus>;
  readonly message: ComputedRef<string>;
  readonly listing: ComputedRef<WorkspaceMembersResponse | null>;
  readonly inviteStatus: Ref<InviteStatus>;
  readonly inviteMessage: Ref<string>;
  readonly load: () => Promise<void>;
  readonly invite: (input: InviteInput) => Promise<void>;
}

/** The wire contract's `email` is a bare string; the form wants a real address before it sends. */
const InviteEmailSchema = z.string().trim().toLowerCase().email();

/**
 * The listing lives in the read layer (`useApiRead`, keyed by
 * `workspaceMembersKey`): server-rendered when the request can be
 * authenticated, kept across screens, and re-read — bypassing what is
 * kept — after every invitation, which is the proof the invitation was
 * recorded (see above).
 */
export function useWorkspaceMembers(workspaceRef: string, deps: UseWorkspaceMembersDeps = {}): UseWorkspaceMembersResult {
  const api = useApiClient();
  const fetchMembers: FetchWorkspaceMembers = deps.fetchMembers ?? ((ref) => api<WorkspaceMembersResponse>(`/workspaces/${ref}/members`));
  const postInvitation: PostInvitation =
    deps.postInvitation ?? ((input) => api<CreateInvitationResponse>('/invitations', { method: 'POST', body: input }));

  const read = useApiRead<WorkspaceMembersResponse>(workspaceMembersKey(workspaceRef), () => fetchMembers(workspaceRef));
  const status = useReadStatus(read, (code) => {
    if (code === 401) return 'unauthenticated';
    if (code === 404) return 'not-found';
    return 'network-error';
  });
  const listing = computed(() => (read.outcome.value?.ok ? read.outcome.value.value : null));
  const MESSAGES: Record<WorkspaceMembersStatus, string> = {
    'idle': '',
    'loading': '',
    'success': '',
    'unauthenticated': 'Your session has ended.',
    'not-found': 'This workspace does not exist, or you do not manage it.',
    'network-error': 'Cannot reach the server. Check your connection and try again.',
  };
  const message = computed(() => MESSAGES[status.value]);
  const load = read.load;
  const inviteStatus = ref<InviteStatus>('idle');
  const inviteMessage = ref('');

  async function invite(input: InviteInput): Promise<void> {
    const email = InviteEmailSchema.safeParse(input.email);
    const rootNodeId = listing.value?.rootNodeId;
    // The invitation names the workspace by id, which the listing carries:
    // the address's slug is not what the API keys a grant by.
    const workspaceId = listing.value?.workspace.id;
    if (!email.success || !rootNodeId || !workspaceId) {
      inviteStatus.value = 'invalid';
      inviteMessage.value = 'Enter the email address of the person to invite.';
      return;
    }
    const request = CreateInvitationRequestSchema.parse({
      workspaceId,
      email: email.data,
      startingGrants: [{ resourceId: rootNodeId, action: input.action }],
    });

    inviteStatus.value = 'sending';
    inviteMessage.value = '';
    try {
      await postInvitation(request);
      inviteStatus.value = 'sent';
      inviteMessage.value = `Invitation sent to ${email.data}. It is listed below until it is accepted.`;
      await load();
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 401) {
        inviteStatus.value = 'unauthenticated';
        inviteMessage.value = 'Your session has ended.';
        return;
      }
      if (code === 404) {
        inviteStatus.value = 'not-found';
        inviteMessage.value = 'This workspace is no longer yours to manage, or it no longer exists.';
        return;
      }
      inviteStatus.value = 'network-error';
      inviteMessage.value = 'Could not reach the server. Check your connection and try again; reload first to see whether the invitation was recorded.';
    }
  }

  return { status, message, listing, inviteStatus, inviteMessage, load, invite };
}
