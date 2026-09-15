-- The workspace shape: a row is a thing, and it keeps its identity when its rank changes.
--
-- Run once, against an existing database:
--   npx wrangler d1 execute kartz-db --remote --file=migrate-006.sql
--
-- Nothing is deleted. `scores` and `roster` are rebuilt to carry a stable row id and a bag of
-- custom columns, with every existing row copied across; the tables it adds are new.
--
-- Why a row id. The grid edits rows, and a row's key used to be the thing being edited: a
-- score was keyed by (board_id, place) and a player by their name, so correcting a rank or a
-- spelling was a delete and an insert, and two rows swapping ranks could not be written at
-- all. An id that nothing ever edits makes an edit an edit.
--
-- Why `extra`. The old sheet kept anything past the fifth column inside a workbook snapshot,
-- which only the spreadsheet library could read. Those columns are the user's data — a note, a
-- CP figure, a legacy column out of Google Sheets — so they belong in the row, keyed by their
-- heading, the way the roster has always kept its own.

-- ---- scores ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scores_v3 (
  id       TEXT PRIMARY KEY,            -- stable; never edited, never derived from a value
  board_id TEXT    NOT NULL,
  place    INTEGER NOT NULL,            -- the rank the game showed
  search   TEXT,                        -- roster name: the identity. NULL for somebody new
  ingame   TEXT    NOT NULL,            -- what the video drew, kept because it changes
  alliance TEXT,                        -- the player's OWN alliance, from the roster
  points   INTEGER NOT NULL,
  edited   INTEGER NOT NULL DEFAULT 0,  -- a person corrected this row; a re-save must not undo it
  extra    TEXT,                        -- JSON, keyed by column heading: the board's own columns
  sort     INTEGER NOT NULL DEFAULT 0   -- the order the rows were left in
);

INSERT INTO scores_v3 (id, board_id, place, search, ingame, alliance, points, edited, extra, sort)
  SELECT board_id || '#' || place, board_id, place, search, ingame, alliance, points, edited, NULL, place
    FROM scores;

DROP TABLE scores;
ALTER TABLE scores_v3 RENAME TO scores;

CREATE INDEX IF NOT EXISTS scores_by_board    ON scores(board_id, place);
CREATE INDEX IF NOT EXISTS scores_by_player   ON scores(search);
CREATE INDEX IF NOT EXISTS scores_by_alliance ON scores(alliance);

-- ---- roster ------------------------------------------------------------------------------
-- search stays the identity every score points at. It is no longer the primary key, so a
-- player can be renamed in one edit; two rows sharing a name are refused by the API, which can
-- say which rows they are, rather than by a constraint that can only fail the whole batch.
CREATE TABLE IF NOT EXISTS roster_v2 (
  id         TEXT PRIMARY KEY,
  search     TEXT NOT NULL,
  ingame     TEXT NOT NULL,
  alliance   TEXT,
  extra      TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO roster_v2 (id, search, ingame, alliance, extra, sort, updated_at)
  SELECT 'p:' || search, search, ingame, alliance, extra, sort, updated_at FROM roster;

DROP TABLE roster;
ALTER TABLE roster_v2 RENAME TO roster;

CREATE INDEX IF NOT EXISTS roster_by_alliance ON roster(alliance);
CREATE INDEX IF NOT EXISTS roster_by_search   ON roster(search);

-- How the roster is laid out on screen: widths, order, what is hidden. Presentation, and the
-- app reads it as a hint — a layout that names a column no longer there is simply ignored.
ALTER TABLE roster_meta ADD COLUMN layout TEXT NOT NULL DEFAULT '{}';

-- ---- a board's own columns ----------------------------------------------------------------
-- `columns` is the headings past the five the record is made of, in order; those are what
-- scores.extra is keyed by. `layout` is presentation. `imported` records that a legacy
-- workbook snapshot has been read into the rows, so it is only ever read once.
CREATE TABLE IF NOT EXISTS board_meta (
  board_id   TEXT PRIMARY KEY,
  columns    TEXT NOT NULL DEFAULT '[]',
  layout     TEXT NOT NULL DEFAULT '{}',
  imported   INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

-- ---- extraction runs ------------------------------------------------------------------------
-- Where a board's rows came from. One row per recording processed, whether or not it was
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
  found      INTEGER NOT NULL DEFAULT 0,   -- names the run produced
  added      INTEGER NOT NULL DEFAULT 0,   -- rows actually written
  duplicates INTEGER NOT NULL DEFAULT 0,   -- rows that already existed
  frames     INTEGER,
  readings   INTEGER,
  status     TEXT NOT NULL DEFAULT 'completed',
  note       TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_time ON extraction_runs(created_at DESC);

-- ---- activity --------------------------------------------------------------------------------
-- Traceability, not version control: what changed, to what, when, and how much of it.
CREATE TABLE IF NOT EXISTS activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,                 -- edit | insert | delete | import | extract | columns | delete-board
  dataset TEXT,                          -- 'roster' or a board id
  summary TEXT NOT NULL,
  detail  TEXT
);
CREATE INDEX IF NOT EXISTS activity_by_time ON activity(at DESC);

-- ---- saved views -------------------------------------------------------------------------------
-- A filter, a sort and a set of visible columns, under a name.
CREATE TABLE IF NOT EXISTS saved_views (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  dataset    TEXT NOT NULL,
  spec       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS views_by_dataset ON saved_views(dataset);
