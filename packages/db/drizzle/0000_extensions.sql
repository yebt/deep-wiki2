-- Converges existing dev volumes (design.md D18): /docker-entrypoint-initdb.d
-- only runs against a fresh data directory, so an existing dev volume would
-- silently never receive a new extension added there. Extension creation
-- therefore lives in a migration instead.
CREATE EXTENSION IF NOT EXISTS vector;
