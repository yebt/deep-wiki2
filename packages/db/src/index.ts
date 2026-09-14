export { createDb } from './client';
export { describeInvalidDatabaseUrl } from './database-url';
export { DatabaseIdentityError, guardDatabaseIdentity, probeDatabaseIdentity } from './database-identity';
export type { Db } from './client';
export {
  createSession,
  deleteAllSessionsForUser,
  deleteSession,
  findSessionByToken,
  touchSession,
} from './auth/sessions';
export type { CreatedSession, CreateSessionInput, SessionRecord } from './auth/sessions';
export { findUserByEmail, updateUserPasswordHash } from './auth/users';
export type { UserCredentials } from './auth/users';
export {
  consumePasswordReset,
  createPasswordReset,
  findPasswordResetByToken,
  simulatePasswordResetWork,
} from './auth/password-resets';
export type { ConsumePasswordResetResult, CreatedPasswordReset, PasswordResetRecord } from './auth/password-resets';
export {
  getInstanceSettings,
  recordSmtpVerification,
  setOpenRegistrationDomains,
  setRegistrationMode,
} from './auth/instance-settings';
export type { InstanceSettings, RegistrationMode, SetRegistrationModeResult } from './auth/instance-settings';
export { acceptInvitation, createInvitation, findInvitationByToken } from './auth/invitations';
export type {
  AcceptInvitationInput,
  AcceptInvitationResult,
  CreatedInvitation,
  CreateInvitationInput,
  InvitationRecord,
} from './auth/invitations';
export { createWorkspace, PlanLimitExceededError } from './workspaces/create-workspace';
export type { CreatedWorkspace, CreateWorkspaceInput } from './workspaces/create-workspace';
export { listReadableWorkspaces } from './workspaces/list-readable-workspaces';
export type { ListReadableWorkspacesInput, WorkspaceSummary } from './workspaces/list-readable-workspaces';
export { readableWorkspaceIds } from './permissions/readable-workspaces';
export type { ReadableWorkspaceIdsInput } from './permissions/readable-workspaces';
export { can, createGrantLookup } from './permissions/queries';
export { insertGrants } from './permissions/grants';
export type { GrantInput } from './permissions/grants';
export { canManyResources, canManySubjects } from './permissions/can-many';
export type { CanManyResourcesInput, CanManySubjectsInput } from './permissions/can-many';
export { readableResourceIds, readableSubjectIds } from './permissions/readable';
export type { ReadableResourceIdsInput, ReadableSubjectIdsInput } from './permissions/readable';
export { isWorkspaceMember, listWorkspaceMemberCandidates } from './permissions/candidates';
export type { IsWorkspaceMemberInput, ListWorkspaceMemberCandidatesInput, UserCandidate } from './permissions/candidates';
export { NotCanonicalError, savePage, StaleContentError } from './content/save-page';
export type { SavePageInput as SavePageDbInput, SavePageResult } from './content/save-page';
// `savePage`'s two refusal paths that a caller is expected to turn into a
// 409 rather than a 500: `NotCanonicalError` above, and this one.
export { ChainCompressionError, DeadAnchorError } from './content/rebuild-derived';
export type { DeadAnchor } from './content/rebuild-derived';
export { readPageHtml, readPageMarkdown } from './content/read-page';
export type { PageContentRef, PageHtml, PageMarkdown } from './content/read-page';
export { backfillOneRow, backfillRender } from './content/backfill-render';
export type { BackfillOneRowInput, BackfillOneRowOutcome, BackfillRenderOptions, BackfillRenderResult } from './content/backfill-render';
export { resolveBookId, resolveChangeset } from './changesets/resolve-changeset';
export type { ResolveBookIdInput, ResolveChangesetInput } from './changesets/resolve-changeset';
export { listChangedPagesSince } from './changesets/book-diff';
export type { ChangedPageSummary, ListChangedPagesSinceInput } from './changesets/book-diff';
export { getRevisionsByIds, listPageRevisions } from './revisions/queries';
export type { GetRevisionsByIdsInput, ListPageRevisionsInput, RevisionContent, RevisionSummary } from './revisions/queries';
export { createReply, createRootComment, listCommentIndicators, setThreadResolved } from './comments/queries';
export type {
  CommentIndicator,
  CreatedComment,
  CreateReplyInput,
  CreateRootCommentInput,
  ListCommentIndicatorsInput,
  SetThreadResolvedInput,
} from './comments/queries';
export { acquireLock, heartbeatLock, readLockStatus, takeOverLock } from './locks/page-lock';
export type {
  AcquireLockInput,
  AcquireLockResult,
  HeartbeatLockInput,
  HeartbeatLockResult,
  LockStatus,
  ReadLockStatusInput,
  TakeOverLockInput,
  TakeOverLockResult,
} from './locks/page-lock';
export { assertLegalParent, IllegalParentTypeError, legalParentTypesUsedBy } from './nodes/legal-parent-types';
export type { NodeType } from './nodes/legal-parent-types';
export {
  createNode,
  DuplicateSiblingSlugError,
  ParentNodeNotFoundError,
  UnslugifiableTitleError,
} from './nodes/create';
export type { CreatedNode, CreateNodeInput } from './nodes/create';
export { NodeNotFoundError, renameNode, WorkspaceRootRenameError } from './nodes/rename';
export type { RenamedNode, RenameNodeInput } from './nodes/rename';
export { CrossWorkspaceMoveError, CyclicMoveError, moveNode } from './nodes/move';
export type { MoveNodeInput } from './nodes/move';
export { reorderNode } from './nodes/reorder';
export type { ReorderNodeInput } from './nodes/reorder';
export { listActivePresence } from './presence/queries';
export type { ListActivePresenceInput, PresenceRow } from './presence/queries';
