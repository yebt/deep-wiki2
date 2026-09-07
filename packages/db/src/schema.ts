/**
 * Drizzle schema for the tenancy and permissions domain
 * (openspec/changes/tenancy-and-permissions/design.md — "Schema").
 *
 * This file declares column shapes, enums, and the constraints Drizzle's
 * DSL can express cleanly (single-column references, plain unique/index).
 * The `nodes_set_path` trigger, the composite tenant-isolation foreign
 * keys, the `path` CHECK constraints, and the partial/functional indexes
 * are NOT modelled here — Drizzle's table DSL cannot express a
 * self-referential composite foreign key or a BEFORE-trigger, and
 * `drizzle-kit generate` is deliberately never run against this file (it
 * would silently drop what it cannot express). Every migration under
 * `packages/db/drizzle/` is hand-written SQL; `migration.test.ts` asserts
 * the hand-written objects exist after `migrate()` runs, so a future drift
 * between this file and the migrations fails the suite, not the tenant.
 */
import { bigint, boolean, customType, date, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Action, Effect } from '@deep-wiki/core';

/**
 * `drizzle-orm/pg-core` has no built-in `bytea` column — this is the
 * documented `customType` escape hatch, mapped to `Uint8Array` to match
 * `SealedCredential`'s field types (`@deep-wiki/core`'s `ai/ports.ts`).
 */
const bytea = customType<{ data: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * `drizzle-orm/pg-core` has no built-in pgvector column either. The
 * dimension is hard-coded at 1536 (embedding-index-integrity spec —
 * "Declared Vector Dimension"; embedding-configuration spec — "Embedding
 * Dimension Fixed at 1536") — an undimensioned `vector` column cannot be
 * HNSW-indexed, verified empirically against a real Postgres instance.
 */
const vector1536 = customType<{ data: readonly number[] }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
});

export const nodeType = pgEnum('node_type', ['workspace', 'shelf', 'book', 'chapter', 'page']);

/**
 * `role` is reserved with no producer in this phase (design.md — Open
 * Questions; task 3.8): adding a Postgres enum value later is a cheap
 * `ALTER TYPE ... ADD VALUE`, removing one is not, so it is committed now
 * rather than deferred. See `0001_tenancy.sql` for the enum DDL comment
 * and `docs/TODO.md` Findings for the recorded reasoning.
 */
export const subjectKind = pgEnum('subject_kind', ['user', 'cell', 'role', 'agent']);

export const permAction = pgEnum('perm_action', ['read', 'comment', 'write', 'manage']);
export const permEffect = pgEnum('perm_effect', ['allow', 'deny']);
export const registrationMode = pgEnum('registration_mode', ['closed', 'invitation_only', 'open']);

/** Mirrors `@deep-wiki/core`'s closed `ProviderId` union (ai-provider-registry spec). */
export const aiProvider = pgEnum('ai_provider', ['anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'local']);
/** Mirrors `@deep-wiki/core`'s closed `StructuredOutputLevel` union. */
export const aiStructuredOutputLevel = pgEnum('ai_structured_output_level', ['schema', 'tool-call', 'prompted', 'none']);
/** A provider SDK error mapped to a closed code set before it ever reaches a logger. */
export const aiCredentialValidationErrorCode = pgEnum('ai_credential_validation_error_code', [
  'invalid_key',
  'insufficient_quota',
  'network',
  'unknown',
]);
/** Mirrors `@deep-wiki/core`'s `LedgerOperation` (ai-usage-accounting spec). */
export const aiUsageOperation = pgEnum('ai_usage_operation', ['chat', 'embed']);
/** Mirrors `@deep-wiki/core`'s `ReservationState` (`ai/budget.ts`). */
export const aiReservationState = pgEnum('ai_reservation_state', ['reserved', 'settled', 'voided']);
/** A generation's lifecycle (embedding-index-integrity spec — "Reindexing Is an Explicit Tracked Job"). */
export const embeddingIndexState = pgEnum('embedding_index_state', ['building', 'active', 'retired']);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  maxWorkspaces: integer('max_workspaces').notNull(),
  maxSeats: integer('max_seats').notNull(),
  maxStorageBytes: text('max_storage_bytes').notNull(),
  maxAiTokensMonthly: text('max_ai_tokens_monthly').notNull(),
  /** `ai_usage_ledger` migration (Phase 11) — enforced by the same admission statement as `maxAiTokensMonthly`. */
  maxAiCostMicroUsdMonthly: text('max_ai_cost_micro_usd_monthly').notNull().default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  avatarKey: text('avatar_key'),
  planId: uuid('plan_id').references(() => plans.id),
  isSuperRoot: boolean('is_super_root').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `parent_id` and the composite `(id, workspace_id)`/`(parent_id,
 * workspace_id)` foreign keys are declared only in the migration SQL — see
 * the module doc comment above.
 */
export const nodes = pgTable('nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  type: nodeType('type').notNull(),
  path: text('path').notNull(),
  position: integer('position').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cells = pgTable('cells', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The composite `(cell_id, workspace_id)` foreign key into `cells` — the
 * structural half of "cell membership is workspace-scoped" — is declared
 * only in the migration SQL (see the module doc comment above).
 */
export const cellMembers = pgTable('cell_members', {
  cellId: uuid('cell_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `resource_type` is deliberately not a column here (design.md D10) — it
 * is `nodes.type` of `resource_id`. The generated `subject_cell_id` /
 * `subject_agent_id` columns and the composite tenant-isolation foreign
 * keys exist only in the migration SQL.
 */
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  subjectType: subjectKind('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  resourceId: uuid('resource_id').notNull(),
  action: permAction('action').notNull(),
  effect: permEffect('effect').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server-side, revocable sessions (design.md D14). Only the SHA-256 hash
 * of the token is ever stored; the raw token exists only in the client's
 * cookie and the brief return value of `createSession()`.
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Password reset tokens (design.md — "Authentication"). Single-use via
 * `consumedAt`; issuing a new token for a user revokes prior unconsumed
 * ones at the application layer, not by a DB constraint.
 */
export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Instance-wide registration policy (design.md — "Registration mode";
 * registration-policy spec). A singleton row — the `id = 1` CHECK in the
 * migration SQL makes a second row structurally impossible.
 */
export const instanceSettings = pgTable('instance_settings', {
  id: integer('id').primaryKey().default(1),
  registrationMode: registrationMode('registration_mode').notNull().default('invitation_only'),
  openRegistrationDomains: text('open_registration_domains').array().notNull().default([]),
  smtpVerifiedAt: timestamp('smtp_verified_at', { withTimezone: true }),
  smtpConfigHash: text('smtp_config_hash'),
});

export interface StartingGrant {
  readonly resourceId: string;
  readonly action: Action;
  readonly effect: Effect;
}

/**
 * Workspace invitations (invitations spec). `startingGrants` is applied
 * verbatim to the `permissions` table on acceptance.
 */
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  startingGrants: jsonb('starting_grants').$type<StartingGrant[]>().notNull().default([]),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Chat configuration only — the embedding pair lives in its own table
 * (Phase 15) because it is FK-referenced by `chunks` (design.md —
 * "Schema"; "Why the embedding pair is a table and not two columns on
 * settings").
 */
export const workspaceAiSettings = pgTable('workspace_ai_settings', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  chatProvider: aiProvider('chat_provider'),
  chatModel: text('chat_model'),
  structuredOutputFloor: aiStructuredOutputLevel('structured_output_floor'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Envelope-encrypted BYOK provider credentials (workspace-ai-credentials
 * spec). No plaintext column exists. The composite `(id, workspace_id)`
 * unique constraint is declared only in the migration SQL (see the
 * module doc comment above) — it exists so a future referencing table
 * can pin a row to its own workspace, in the same idiom as
 * `nodes_id_workspace_id_unique`.
 */
export const workspaceAiCredentials = pgTable('workspace_ai_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: aiProvider('provider').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  iv: bytea('iv').notNull(),
  authTag: bytea('auth_tag').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  keyId: text('key_id').notNull(),
  alg: text('alg').notNull().default('aes-256-gcm'),
  lastFour: text('last_four').notNull(),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  validationErrorCode: aiCredentialValidationErrorCode('validation_error_code'),
  compromisedAt: timestamp('compromised_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-call usage events (ai-usage-accounting spec; design.md — "Cost
 * enforcement, in the same path that builds the call"). The partial
 * index over live reservations and the `CHECK (state <> 'settled' OR
 * actual_micro_usd IS NOT NULL)` constraint are declared only in the
 * migration SQL (see the module doc comment above).
 */
export const aiUsageEvents = pgTable('ai_usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  subjectType: subjectKind('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  provider: aiProvider('provider').notNull(),
  model: text('model').notNull(),
  operation: aiUsageOperation('operation').notNull(),
  state: aiReservationState('state').notNull().default('reserved'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedInputTokens: integer('cached_input_tokens'),
  reservedMicroUsd: bigint('reserved_micro_usd', { mode: 'number' }).notNull(),
  actualMicroUsd: bigint('actual_micro_usd', { mode: 'number' }),
  prefixHash: text('prefix_hash'),
  degradationLevel: aiStructuredOutputLevel('degradation_level'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp('settled_at', { withTimezone: true }),
});

/**
 * Per-(workspace, month) budget aggregate (ai-usage-accounting spec).
 * This table is a report surface, not the enforcement mechanism itself —
 * see the migration SQL's module doc comment for why admission
 * recomputes its live outstanding total straight from `ai_usage_events`.
 */
export const workspaceAiBudgetPeriods = pgTable('workspace_ai_budget_periods', {
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  reservedMicroUsd: bigint('reserved_micro_usd', { mode: 'number' }).notNull().default(0),
  settledMicroUsd: bigint('settled_micro_usd', { mode: 'number' }).notNull().default(0),
  settledTokens: bigint('settled_tokens', { mode: 'number' }).notNull().default(0),
  limitMicroUsd: bigint('limit_micro_usd', { mode: 'number' }).notNull(),
  tokenLimit: bigint('token_limit', { mode: 'number' }),
});

/**
 * Runtime-contradiction drift detection (design.md — "Drift detection";
 * D11, D20). No `workspace_id`: this records the registry's own
 * correctness, not tenant content (see the migration SQL's comment).
 */
export const aiCapabilityObservations = pgTable('ai_capability_observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: aiProvider('provider').notNull(),
  model: text('model').notNull(),
  declaredLevel: aiStructuredOutputLevel('declared_level').notNull(),
  observedLevel: aiStructuredOutputLevel('observed_level').notNull(),
  errorCode: text('error_code'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Index generations, not columns on settings (design.md — "Why the
 * embedding pair is a table and not two columns on settings"; D14). The
 * `UNIQUE (workspace_id, embedding_model, dimensions)` constraint and the
 * partial `UNIQUE (workspace_id) WHERE state = 'active'` index are
 * declared only in the migration SQL (see the module doc comment above).
 */
export const workspaceEmbeddingIndexes = pgTable('workspace_embedding_indexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  embeddingProvider: aiProvider('embedding_provider').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  dimensions: integer('dimensions').notNull(),
  state: embeddingIndexState('state').notNull().default('building'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
});

/**
 * Ships with no writer and no query (D15) — the integrity contract has
 * to exist before rows do. The composite FKs to `nodes (id,
 * workspace_id)` and to `workspace_embedding_indexes`' own composite
 * unique key are declared only in the migration SQL.
 */
export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  pageId: uuid('page_id').notNull(),
  blockIds: text('block_ids').array().notNull().default([]),
  content: text('content').notNull(),
  embedding: vector1536('embedding').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  dimensions: integer('dimensions').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
