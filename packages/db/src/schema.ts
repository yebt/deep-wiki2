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
