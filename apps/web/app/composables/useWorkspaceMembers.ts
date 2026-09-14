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

export type WorkspaceMembersStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';
export type InviteStatus = 'idle' | 'sending' | 'sent' | 'invalid' | 'not-found' | 'unauthenticated' | 'network-error';

export interface InviteInput {
  readonly email: string;
  readonly action: ActionValue;
}

export type FetchWorkspaceMembers = (workspaceId: string) => Promise<WorkspaceMembersResponse>;
export type PostInvitation = (input: CreateInvitationRequest) => Promise<CreateInvitationResponse>;

export interface UseWorkspaceMembersDeps {
  readonly fetchMembers?: FetchWorkspaceMembers;
  readonly postInvitation?: PostInvitation;
}

export interface UseWorkspaceMembersResult {
  readonly status: Ref<WorkspaceMembersStatus>;
  readonly message: Ref<string>;
  readonly listing: Ref<WorkspaceMembersResponse | null>;
  readonly inviteStatus: Ref<InviteStatus>;
  readonly inviteMessage: Ref<string>;
  readonly load: () => Promise<void>;
  readonly invite: (input: InviteInput) => Promise<void>;
}

/** The wire contract's `email` is a bare string; the form wants a real address before it sends. */
const InviteEmailSchema = z.string().trim().toLowerCase().email();

export function useWorkspaceMembers(workspaceId: string, deps: UseWorkspaceMembersDeps = {}): UseWorkspaceMembersResult {
  const config = useRuntimeConfig();
  const fetchMembers: FetchWorkspaceMembers =
    deps.fetchMembers ??
    ((id) => $fetch<WorkspaceMembersResponse>(`${config.public.apiBaseUrl}/workspaces/${id}/members`, { credentials: 'include' }));
  const postInvitation: PostInvitation =
    deps.postInvitation ??
    ((input) =>
      $fetch<CreateInvitationResponse>(`${config.public.apiBaseUrl}/invitations`, {
        method: 'POST',
        body: input,
        credentials: 'include',
      }));

  const status = ref<WorkspaceMembersStatus>('idle');
  const message = ref('');
  const listing = ref<WorkspaceMembersResponse | null>(null);
  const inviteStatus = ref<InviteStatus>('idle');
  const inviteMessage = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    try {
      listing.value = await fetchMembers(workspaceId);
      status.value = 'success';
      message.value = '';
    } catch (error) {
      listing.value = null;
      const code = httpStatusOf(error);
      if (code === 401) {
        status.value = 'unauthenticated';
        message.value = 'Your session has ended.';
        return;
      }
      if (code === 404) {
        status.value = 'not-found';
        message.value = 'This workspace does not exist, or you do not manage it.';
        return;
      }
      status.value = 'network-error';
      message.value = 'Cannot reach the server. Check your connection and try again.';
    }
  }

  async function invite(input: InviteInput): Promise<void> {
    const email = InviteEmailSchema.safeParse(input.email);
    const rootNodeId = listing.value?.rootNodeId;
    if (!email.success || !rootNodeId) {
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
