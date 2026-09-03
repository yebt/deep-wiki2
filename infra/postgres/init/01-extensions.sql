-- Runs once, on first container start, against a fresh data directory
-- (postgres's own entrypoint convention for /docker-entrypoint-initdb.d).
-- Enables pgvector so the domain schema (Phase 1+) can declare vector
-- columns and similarity indexes in the same database as everything else.
CREATE EXTENSION IF NOT EXISTS vector;
