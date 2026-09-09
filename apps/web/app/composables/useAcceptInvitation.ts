import {
  AcceptInvitationRequestSchema,
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
} from '@deep-wiki/contracts';

export type AcceptInvitationStatus =
  | 'idle'
  | 'loading'
  | 'invalid'
  | 'expired'
  | 'already-used'
  | 'network-error'
  | 'success';

export type AcceptInvitationFetcher = (input: AcceptInvitationRequest) => Promise<AcceptInvitationResponse>;

export interface UseAcceptInvitationResult {
  readonly status: Ref<AcceptInvitationStatus>;
  readonly message: Ref<string>;
  readonly workspaceId: Ref<string | null>;
  readonly accept: (input: AcceptInvitationRequest) => Promise<void>;
}

/**
 * `POST /invitations/accept` (invitations spec). Unlike password reset,
 * the API genuinely distinguishes three rejection shapes by status code —
 * invalid (400), expired (410), already accepted (409) — so this
 * composable surfaces all three as their own named state, per
 * docs/UI-CHECKLIST.md §3: "An invitation link that is expired or already
 * used is its own state, not a generic error."
 */
export function useAcceptInvitation(fetcher?: AcceptInvitationFetcher): UseAcceptInvitationResult {
  const post =
    fetcher ??
    ((input: AcceptInvitationRequest) => {
      const config = useRuntimeConfig();
      return $fetch<AcceptInvitationResponse>(`${config.public.apiBaseUrl}/invitations/accept`, {
        method: 'POST',
        body: input,
        credentials: 'include',
      });
    });

  const status = ref<AcceptInvitationStatus>('idle');
  const message = ref('');
  const workspaceId = ref<string | null>(null);

  async function accept(input: AcceptInvitationRequest): Promise<void> {
    const parsed = AcceptInvitationRequestSchema.safeParse(input);
    if (!parsed.success) {
      status.value = 'idle';
      message.value = 'Choose a password to finish joining.';
      return;
    }

    status.value = 'loading';
    message.value = 'Joining the workspace…';

    try {
      const result = await post(parsed.data);
      status.value = 'success';
      workspaceId.value = result.workspaceId;
      message.value = 'You have joined the workspace.';
    } catch (error) {
      if (serverResponded(error)) {
        const httpStatus = httpStatusOf(error);
        if (httpStatus === 410) {
          status.value = 'expired';
          message.value = 'This invitation has expired. Ask whoever invited you to send a new one.';
        } else if (httpStatus === 409) {
          status.value = 'already-used';
          message.value = 'This invitation has already been used. Sign in instead.';
        } else {
          status.value = 'invalid';
          message.value = "This invitation link isn't valid.";
        }
      } else {
        status.value = 'network-error';
        message.value = 'Could not reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, message, workspaceId, accept };
}
