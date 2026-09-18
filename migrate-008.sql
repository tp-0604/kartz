-- Accounts, owners, and who did what.
--
-- Run once, against an existing database:
--   npx wrangler d1 execute kartz-db --remote --file=migrate-008.sql
--
-- Nothing is deleted or rewritten. Two tables are new and six columns are added. The boards that
-- exist today get no owner, which is what makes them an admin's to delete, rename or replace.

-- Everyone signs up: an in-game name, written plainly, and a password. A name belongs to one
-- account, however it is capitalised or spaced — that is what name_key is for.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,                    -- the in-game name as typed, no fancy text
  name_key   TEXT NOT NULL,                    -- lower-cased and trimmed: what "the same name" means
  role       TEXT NOT NULL DEFAULT 'member',   -- member | admin
  pass_hash  TEXT NOT NULL,                    -- PBKDF2-SHA256, salted
  pass_salt  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_by_name ON users(name_key);

-- A browser that has signed in holds a random token; this holds only its hash.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);

-- Who sent a board, and who ran an extraction. NULL means before accounts.
ALTER TABLE boards ADD COLUMN created_by TEXT;
ALTER TABLE extraction_runs ADD COLUMN created_by TEXT;

-- Who did each thing in the log, and the sentence written about an editing session.
ALTER TABLE activity ADD COLUMN actor_id TEXT;
ALTER TABLE activity ADD COLUMN actor_name TEXT;
ALTER TABLE activity ADD COLUMN ai_summary TEXT;
ALTER TABLE activity ADD COLUMN summarized INTEGER NOT NULL DEFAULT 0;
