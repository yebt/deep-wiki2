export { err, ok } from './result';
export type { Result } from './result';
export type { BlobStore, BlobStoreError, PutObjectInput } from './ports/blob-store';
export type { MailSendError, MailSender, SendMailInput } from './ports/mail-sender';
export type { PresenceBroadcaster, PresenceEvent, PresenceSubscriber } from './ports/presence-broadcaster';
export { impliedAllowActions, impliedDenyActions } from './permissions/actions';
export { can } from './permissions/can';
export { decide } from './permissions/decide';
export { decideMany } from './permissions/decide-many';
export type { Action, Effect, GrantLookup, GrantQuery, ResolvedGrant, SubjectKind } from './permissions/types';
export {
  IllegalParentTypeError,
  isLegalParentType,
  LEGAL_PARENT_TYPES,
  legalChildTypes,
  NODE_TYPES,
} from './nodes/hierarchy';
export type { NodeType } from './nodes/hierarchy';
export { MAX_SLUG_LENGTH, slugifyTitle } from './nodes/slug';
export { normalizeEmail } from './email';
export { Secret } from './secret';
export type { PasswordHasher } from './ports/password-hasher';
export {
  buildPath,
  isDescendantPath,
  isStrictDescendantPath,
  isWithinPathBound,
  MAX_PATH_LENGTH,
  parsePath,
  PATH_DELIMITER,
} from './paths';
export type {
  BlockId,
  BlockIndexEntry,
  BlockStatus,
  PageContent,
  PageContentRef,
  PersistedBlock,
  SavePageInput,
} from './content/types';
export type { Revision } from './content/revision';
export type { Changeset } from './content/changeset';
export type { CommentAnchor } from './content/comment';
export type { BlockChange, BlockDiff } from './content/diff';
export type { InvalidModelId, InvalidModelIdReason, ModelRef, ProviderId } from './ai/ids';
export { parseModelId } from './ai/ids';
export type { ModelCapabilities, ModelPricing, StructuredOutputLevel, UnknownModel } from './ai/registry';
export { capabilitiesOf, MODEL_REGISTRY } from './ai/registry';
export { degrade } from './ai/degrade';
export type { ChatUsage } from './ai/pricing';
export { computeCostMicroUsd } from './ai/pricing';
export type {
  AdmissionInput,
  BudgetPeriod,
  BudgetRefusal,
  Reservation,
  ReservationState,
  VoidReason,
} from './ai/budget';
export { outstandingMicroUsd, reserve, settle, voidReservation } from './ai/budget';
export type { StablePrefix, StablePrefixInput } from './ai/prefix';
export { buildPrefix } from './ai/prefix';
export type { CredentialAad } from './ai/aad';
export { buildAad } from './ai/aad';
export type {
  ChatFinishReason,
  ChatModelPort,
  ChatRequest,
  ChatResult,
  ChatStream,
  CipherError,
  CredentialCipher,
  EmbedRequest,
  EmbedResult,
  EmbeddingModelPort,
  KeyError,
  KeyProvider,
  LedgerAdmissionInput,
  LedgerError,
  LedgerOperation,
  ProviderError,
  ProviderErrorCode,
  PromptPart,
  SealedCredential,
  UsageLedger,
} from './ai/ports';
export type {
  EmbeddingModelCandidate,
  EmbeddingRegistrationRefusal,
  EmbeddingRegistrationRefusalReason,
  LocalFallbackResult,
  RegisteredEmbeddingModel,
} from './ai/embedding-registration';
export { EMBEDDING_DIMENSION, registerEmbeddingModel, resolveLocalFallback } from './ai/embedding-registration';
export type { EffectiveEmbeddingProvider, EmbeddingConfigurationInput } from './ai/embedding-configuration';
export { offeredEmbeddingProviderIds, resolveEffectiveEmbeddingProvider } from './ai/embedding-configuration';
