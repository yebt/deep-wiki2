DROP TRIGGER IF EXISTS "nodes_set_path_trigger" ON "nodes";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "nodes_set_path"();
--> statement-breakpoint
DROP TABLE IF EXISTS "nodes";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspaces";
--> statement-breakpoint
DROP TABLE IF EXISTS "users";
--> statement-breakpoint
DROP TABLE IF EXISTS "plans";
--> statement-breakpoint
DROP TYPE IF EXISTS "registration_mode";
--> statement-breakpoint
DROP TYPE IF EXISTS "perm_effect";
--> statement-breakpoint
DROP TYPE IF EXISTS "perm_action";
--> statement-breakpoint
DROP TYPE IF EXISTS "subject_kind";
--> statement-breakpoint
DROP TYPE IF EXISTS "node_type";
