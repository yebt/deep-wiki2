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
import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Action, Effect } from '@deep-wiki/core';

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
export const blockStatus = pgEnum('block_status', ['active', 'superseded', 'tombstoned']);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  maxWorkspaces: integer('max_workspaces').notNull(),
  maxSeats: integer('max_seats').notNull(),
  maxStorageBytes: text('max_storage_bytes').notNull(),
  maxAiTokensMonthly: text('max_ai_tokens_monthly').notNull(),
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
 * A page's canonical Markdown and its derived render/index (content-and-editor
 * design.md "Schema"). The three-column FK `(node_id, workspace_id,
 * node_type)` into `nodes (id, workspace_id, type)` — and the
 * `nodes_id_workspace_id_type_key` unique key it targets — are declared
 * only in the migration SQL (see the module doc comment above).
 */
export const pageContent = pgTable('page_content', {
  nodeId: uuid('node_id').primaryKey(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  nodeType: nodeType('node_type').notNull().default('page'),
  markdown: text('markdown').notNull(),
  renderedHtml: text('rendered_html').notNull().default(''),
  blockIndex: jsonb('block_index').notNull().default({}),
  contentHash: text('content_hash').notNull(),
  pipelineVersion: integer('pipeline_version').notNull().default(1),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The durable record of persisted block ids (design.md "Block identity" —
 * Registry). The composite primary key, the composite FK into
 * `page_content`, and the self-referential `superseded_by` FK are declared
 * only in the migration SQL.
 */
export const pageBlocks = pgTable('page_blocks', {
  pageId: uuid('page_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  blockId: text('block_id').notNull(),
  status: blockStatus('status').notNull(),
  supersededBy: text('superseded_by'),
  /** The id of the block this one split from, written once at insert (0011_block_split_provenance.sql). */
  splitFrom: text('split_from'),
  contentHash: text('content_hash').notNull(),
  excerpt: text('excerpt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The derived, save-triggered knowledge graph (content-and-editor design.md
 * "Schema"; knowledge-graph spec). `source_page_id`'s composite FK into
 * `page_content` and `target_page_id`'s nullable composite FK into `nodes`
 * are declared only in the migration SQL — see the module doc comment
 * above. Rows here are replaced wholesale by
 * `packages/db/src/content/rebuild-derived.ts` on every save; no other
 * module may write them (`scripts/checks/query-boundaries.ts`).
 */
export const links = pgTable('links', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourcePageId: uuid('source_page_id').notNull(),
  targetPageId: uuid('target_page_id'),
  targetRaw: text('target_raw').notNull(),
  sourceBlockId: text('source_block_id'),
  anchor: text('anchor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A workspace-scoped `#tag` name (knowledge-graph spec). The
 * `(workspace_id, name)` and `(id, workspace_id)` unique constraints are
 * declared only in the migration SQL.
 */
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A page's association with a tag (knowledge-graph spec: Tags And
 * Page-Tag Associations Are Rebuilt On Save). The composite primary key
 * and both composite foreign keys are declared only in the migration SQL.
 */
export const pageTags = pgTable('page_tags', {
  pageId: uuid('page_id').notNull(),
  tagId: uuid('tag_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The soft lock (content-and-editor design.md "The soft lock, coherent
 * without presence"). No expiry column: a lock is held iff
 * `heartbeat_at > now() - PAGE_LOCK_TTL_SECONDS`, computed on read by
 * `packages/db/src/locks/page-lock.ts`. The composite FK into
 * `page_content` is declared only in the migration SQL.
 */
export const pageLocks = pgTable('page_locks', {
  nodeId: uuid('node_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  holderUserId: uuid('holder_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
  takenOverFrom: uuid('taken_over_from').references(() => users.id, { onDelete: 'set null' }),
  takenOverAt: timestamp('taken_over_at', { withTimezone: true }),
});
