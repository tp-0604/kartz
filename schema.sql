-- The whole database, as a new one is created. An existing database is brought here by the
-- migrations in order; migrate-006.sql is the one that makes this shape out of the last.
--
-- A board is a thing, and its scores belong to it.
--
-- One flat table was the first shape, and it made a board something you could only identify by
-- repeating its date and alliance on every one of a hundred and fifty rows. Deleting one meant
-- deleting by description, relabelling meant rewriting every row, and a board with no scores
-- yet could not exist at all.
CREATE TABLE IF NOT EXISTS boards (
  id       TEXT PRIMARY KEY,            -- event|date|alliance: saving the same one replaces it
  event    TEXT NOT NULL DEFAULT 'kartz',
  date     TEXT NOT NULL,               -- ISO. the month falls out of it, so does the ordering
  alliance TEXT NOT NULL,               -- whose board was filmed
  label    TEXT,                        -- 'Day 1', 'Final'. optional, and free text on purpose
  saved_at TEXT NOT NULL,
  version  INTEGER NOT NULL DEFAULT 1   -- bumped on every write; a save from a stale copy is refused
);

-- A row keeps its identity when its values change. `id` is never edited and never derived from
-- a value, so correcting a rank or a spelling is an update rather than a delete and an insert,
-- and two rows swapping ranks is two updates rather than a constraint violation.
--
-- The five typed columns are the record — what every view queries and what the AI tools
-- aggregate. `extra` is the board's own columns, keyed by their heading, listed in
-- board_meta.columns: a note, a CP figure, a legacy column out of Google Sheets. They are kept
-- without being interpreted, and they are never lost.
CREATE TABLE IF NOT EXISTS scores (
  id       TEXT PRIMARY KEY,
  board_id TEXT    NOT NULL,
  place    INTEGER NOT NULL,            -- the rank the game showed
  search   TEXT,                        -- roster name: the identity. NULL for somebody new
  ingame   TEXT    NOT NULL,            -- what the video drew, kept because it changes
  alliance TEXT,                        -- the player's OWN alliance, from the roster
  points   INTEGER NOT NULL,
  edited   INTEGER NOT NULL DEFAULT 0,  -- a person corrected this row; a re-save must not undo it
  extra    TEXT,                        -- JSON, keyed by column heading
  sort     INTEGER NOT NULL DEFAULT 0   -- the order the rows were left in
);

-- Alliance is stored twice and the two answer different questions. boards.alliance is which
-- board was filmed; scores.alliance is whose player this is. The recording of 27 August was
-- 120 players from 698W and 32 from elsewhere, so a single column would have filed Duke under
-- 698W permanently while the roster said 698S — and "how did 698S do in September" would have
-- quietly lost him a year later, with nothing about the table looking wrong.

CREATE INDEX IF NOT EXISTS scores_by_board    ON scores(board_id, place);
CREATE INDEX IF NOT EXISTS scores_by_player   ON scores(search);
CREATE INDEX IF NOT EXISTS scores_by_alliance ON scores(alliance);
CREATE INDEX IF NOT EXISTS boards_by_date     ON boards(event, date);

-- Which columns a board carries past the record, and how they are laid out on screen.
-- `imported` marks that the workbook snapshot an older version of this app saved has been read
-- into the rows, so it is only ever read once.
CREATE TABLE IF NOT EXISTS board_meta (
  board_id   TEXT PRIMARY KEY,
  columns    TEXT NOT NULL DEFAULT '[]',
  layout     TEXT NOT NULL DEFAULT '{}',
  imported   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- Legacy. One workbook snapshot per board, written by the version of this app that embedded a
-- spreadsheet library. Nothing writes here any more; it is read once per board to recover the
-- columns somebody added to the right of the record, and then left alone.
CREATE TABLE IF NOT EXISTS board_sheets (
  board_id   TEXT PRIMARY KEY,
  snapshot   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The roster.
--
-- It lived in a Google Sheet tab and was pulled from it, with this database holding only the
-- differences. That made the sheet the record and the app a reader of it, which is backwards
-- now that the roster is maintained here: there is one list, it is these rows, and nothing has
-- to be pulled from anywhere.
--
-- `search` is the identity every score points at. It is not the primary key: a player can be
-- renamed, and two rows sharing a name are refused by the API — which can say which rows they
-- are — rather than by a constraint that can only fail the whole batch.
CREATE TABLE IF NOT EXISTS roster (
  id         TEXT PRIMARY KEY,
  search     TEXT NOT NULL,               -- the identity; scores.search is the same string
  ingame     TEXT NOT NULL,               -- the name as the game draws it
  alliance   TEXT,
  extra      TEXT,                        -- JSON, keyed by column heading: CP, march types, notes
  sort       INTEGER NOT NULL DEFAULT 0,  -- the order the rows were left in
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS roster_by_alliance ON roster(alliance);
CREATE INDEX IF NOT EXISTS roster_by_search   ON roster(search);

-- One row, holding what belongs to the list rather than to any player: which columns it has,
-- which three of them the app reads, how they are laid out, and a version so two officers
-- cannot silently overwrite.
CREATE TABLE IF NOT EXISTS roster_meta (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  columns  TEXT NOT NULL DEFAULT '[]',    -- JSON array of headings, in order
  labels   TEXT NOT NULL DEFAULT '[]',    -- legacy: the three fixed headings, as titled
  mapping  TEXT NOT NULL DEFAULT '{}',    -- which heading is search / ingame / alliance
  snapshot TEXT,                          -- legacy workbook snapshot; nothing writes here now
  layout   TEXT NOT NULL DEFAULT '{}',
  version  INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT
);
INSERT OR IGNORE INTO roster_meta (id, columns, labels, version) VALUES (1, '[]', '[]', 0);

-- Where a board's rows came from: one row per recording processed, whether or not it was
-- committed, so "which recording put these 84 names here" has an answer.
CREATE TABLE IF NOT EXISTS extraction_runs (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  board_id   TEXT,
  event      TEXT NOT NULL DEFAULT 'kartz',
  date       TEXT,
  alliance   TEXT,
  label      TEXT,
  video      TEXT,
  found      INTEGER NOT NULL DEFAULT 0,
  added      INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  frames     INTEGER,
  readings   INTEGER,
  status     TEXT NOT NULL DEFAULT 'completed',
  note       TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_time ON extraction_runs(created_at DESC);

-- Traceability, not version control: what changed, to what, when, and how much of it.
CREATE TABLE IF NOT EXISTS activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  dataset TEXT,
  summary TEXT NOT NULL,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS activity_by_time ON activity(at DESC);

-- A filter, a sort and a set of visible columns, under a name.
CREATE TABLE IF NOT EXISTS saved_views (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  dataset    TEXT NOT NULL,
  spec       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS views_by_dataset ON saved_views(dataset);
