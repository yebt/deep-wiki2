/**
 * `POST /workspaces` — create a workspace for the signed-in user.
 *
 * Every refusal the route can give is its own state here, because the
 * user's next action differs for each (docs/UI-CHECKLIST.md §3): at the
 * plan's limit there is nothing to retry and the number is what to show;
 * with no plan at all only the instance operator can help; a taken slug
 * is a field to change, with everything else kept; a 401 is "sign in".
 * The route's `reason` field is what decides, never the status code
 * alone — 403 carries two different reasons, and a 403 with neither is
 * treated as the recoverable error rather than guessed at.
 */
import {
  CreateWorkspaceRefusalSchema,
  CreateWorkspaceRequestSchema,
  type CreateWorkspaceRequest,
  type CreateWorkspaceResponse,
} from '@deep-wiki/contracts';

export type CreateWorkspaceStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'invalid'
  | 'plan-limit'
  | 'no-plan'
  | 'slug-taken'
  | 'unauthenticated'
  | 'network-error';

export interface PlanLimit {
  readonly planName: string;
  readonly maxWorkspaces: number;
}

export type CreateWorkspaceFetcher = (input: CreateWorkspaceRequest) => Promise<CreateWorkspaceResponse>;

/** What was created, plus the slug it answers to — the one submitted, which every address to it now carries (`utils/routes.ts`). */
export interface CreatedWorkspace extends CreateWorkspaceResponse {
  readonly slug: string;
}

export interface UseCreateWorkspaceResult {
  readonly status: Ref<CreateWorkspaceStatus>;
  readonly message: Ref<string>;
  readonly workspace: Ref<CreatedWorkspace | null>;
  readonly limit: Ref<PlanLimit | null>;
  readonly create: (input: CreateWorkspaceRequest) => Promise<void>;
}

export function useCreateWorkspace(fetcher?: CreateWorkspaceFetcher): UseCreateWorkspaceResult {
  const post =
    fetcher ??
    ((input: CreateWorkspaceRequest) => {
      const config = useRuntimeConfig();
      return $fetch<CreateWorkspaceResponse>(`${config.public.apiBaseUrl}/workspaces`, {
        method: 'POST',
        body: input,
        credentials: 'include',
      });
    });

  const status = ref<CreateWorkspaceStatus>('idle');
  const message = ref('');
  const workspace = ref<CreatedWorkspace | null>(null);
  const limit = ref<PlanLimit | null>(null);

  async function create(input: CreateWorkspaceRequest): Promise<void> {
    const parsed = CreateWorkspaceRequestSchema.safeParse(input);
    if (!parsed.success) {
      status.value = 'invalid';
      message.value = 'Give the workspace a name and a slug of lowercase letters, digits and single hyphens.';
      return;
    }

    status.value = 'loading';
    message.value = '';
    limit.value = null;

    try {
      workspace.value = { ...(await post(parsed.data)), slug: parsed.data.slug };
      status.value = 'success';
      message.value = `Created ${parsed.data.name}.`;
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 401) {
        status.value = 'unauthenticated';
        message.value = 'Your session has ended.';
        return;
      }
      const refusal = CreateWorkspaceRefusalSchema.safeParse(responseBodyOf(error));
      if (refusal.success && refusal.data.reason === 'plan_limit') {
        status.value = 'plan-limit';
        limit.value = { planName: refusal.data.planName, maxWorkspaces: refusal.data.maxWorkspaces };
        message.value = `Your plan allows ${refusal.data.maxWorkspaces} workspace${refusal.data.maxWorkspaces === 1 ? '' : 's'}, and you already own that many.`;
        return;
      }
      if (refusal.success && refusal.data.reason === 'no_plan') {
        status.value = 'no-plan';
        message.value = 'Your account has no plan yet, so it cannot create a workspace.';
        return;
      }
      if (refusal.success && refusal.data.reason === 'slug_taken') {
        status.value = 'slug-taken';
        message.value = 'That slug is already taken. Choose another.';
        return;
      }
      status.value = 'network-error';
      message.value = 'Could not reach the server. Check your connection and try again.';
    }
  }

  return { status, message, workspace, limit, create };
}
