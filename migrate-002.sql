-- The roster lives in a Google Sheet and always has. This table does not replace it: it holds
-- only the differences, so a pull from the sheet stays the thing that brings in new players
-- and an edit made here is not wiped by the next pull.
--
-- Keyed by search — the roster name, which is the identity everywhere else in this database
-- (scores.search is the same string). ingame and alliance are NULL when the sheet's value is
-- being kept, so a row here says what changed and nothing more.
CREATE TABLE IF NOT EXISTS roster_edits (
  search    TEXT PRIMARY KEY,
  ingame    TEXT,                              -- override of the name as the game draws it
  alliance  TEXT,                              -- override of the player's alliance
  added     INTEGER NOT NULL DEFAULT 0,        -- 1 = not in the sheet at all; created here
  removed   INTEGER NOT NULL DEFAULT 0,        -- 1 = hidden from the effective roster
  edited_at TEXT NOT NULL
);
