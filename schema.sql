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
  version  INTEGER NOT NULL DEFAULT 1,  -- bumped on every write; a save from a stale copy is refused
  created_by TEXT                       -- the account that sent it; NULL for boards from before accounts
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
  style    TEXT,                        -- JSON: fills, bold, colour, keyed by column. Swatch
                                        -- names, never hex, so the theme can resolve them
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

-- One workbook per board, as "Open in spreadsheet" saved it: formulas, merges and formats, stored
-- as {version, workbook} and handed back only while the board is still at that version. An older
-- version of this app stored a bare snapshot here; that shape is read once per board, for the
-- columns somebody added to the right of the record.
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
  style      TEXT,                        -- JSON: fills, bold, colour, keyed by column
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
  note       TEXT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_time ON extraction_runs(created_at DESC);

-- Traceability, not version control: what changed, to what, when, and how much of it.
CREATE TABLE IF NOT EXISTS activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  dataset TEXT,
  summary TEXT NOT NULL,
  detail  TEXT,
  actor_id   TEXT,                       -- who did it
  actor_name TEXT,
  ai_summary TEXT,                       -- the sentence written about an editing session
  summarized INTEGER NOT NULL DEFAULT 0  -- an edit already folded into one
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

-- Everyone signs up: an in-game name, written plainly, and a password. A name belongs to one
-- account, however it is capitalised or spaced — that is what name_key is for.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,
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

-- ==== files, sheets and the grid (migration 009) ====================================

-- The tree. A folder with no parent is a top-level one.
CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS folders_by_parent ON folders(parent_id, sort, name);

-- A workbook: what was imported, or what somebody made here.
CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  folder_id   TEXT,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'new',   -- new | xlsx | csv | kartz
  source_name TEXT,                          -- the file it came from, as it was named
  sheets      INTEGER NOT NULL DEFAULT 0,
  cells       INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  ready       INTEGER NOT NULL DEFAULT 0,    -- 0 while an import is still writing
  report      TEXT,                          -- what came across and what did not, as JSON
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS files_by_folder ON files(folder_id, name);

-- One tab.
CREATE TABLE IF NOT EXISTS sheets (
  id        TEXT PRIMARY KEY,
  file_id   TEXT NOT NULL,
  name      TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  shape     TEXT NOT NULL DEFAULT 'table',   -- table | layout | mixed | empty
  rows      INTEGER NOT NULL DEFAULT 0,
  cols      INTEGER NOT NULL DEFAULT 0,
  cells     INTEGER NOT NULL DEFAULT 0,
  hidden    INTEGER NOT NULL DEFAULT 0,
  frozen    TEXT,                            -- {"rows":2,"cols":1}
  tab_color TEXT,
  defaults  TEXT,                            -- {"colWidth":100,"rowHeight":21}
  version   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS sheets_by_file ON sheets(file_id, idx);

-- The grid. One row per five hundred sheet rows, gzipped, so opening a sheet pulls the bands
-- being looked at rather than the whole tab. D1 caps a row at 2 MB; a slab is kept far below.
CREATE TABLE IF NOT EXISTS slabs (
  sheet_id TEXT NOT NULL,
  band     INTEGER NOT NULL,
  cells    BLOB NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  bytes    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sheet_id, band)
);

-- Presentation, pooled per file: forty thousand cells share a few hundred styles.
CREATE TABLE IF NOT EXISTS styles (
  file_id TEXT NOT NULL,
  idx     INTEGER NOT NULL,
  json    TEXT NOT NULL,
  PRIMARY KEY (file_id, idx)
);

-- Everything that is neither a value nor a cell style: merges, column widths, row heights,
-- dropdowns, conditional formats, the filter range, links, and where the pictures sit.
CREATE TABLE IF NOT EXISTS sheet_meta (
  sheet_id TEXT NOT NULL,
  kind     TEXT NOT NULL,
  json     TEXT NOT NULL,
  PRIMARY KEY (sheet_id, kind)
);

-- A picture pasted into a sheet. The bytes live in R2; this row says which object, and one
-- object serves every sheet that pastes the same picture.
CREATE TABLE IF NOT EXISTS assets (
  id         TEXT PRIMARY KEY,               -- the content hash, which is also the R2 key
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT
);

-- The projection: a region of a sheet that really is a table.
CREATE TABLE IF NOT EXISTS tables (
  id         TEXT PRIMARY KEY,
  sheet_id   TEXT NOT NULL,
  name       TEXT,
  header_row INTEGER NOT NULL DEFAULT 0,
  first_row  INTEGER NOT NULL DEFAULT 0,
  last_row   INTEGER NOT NULL DEFAULT 0,
  first_col  INTEGER NOT NULL DEFAULT 0,
  last_col   INTEGER NOT NULL DEFAULT 0,
  rows       INTEGER NOT NULL DEFAULT 0,
  columns    TEXT NOT NULL                   -- [{"key":"cp","header":"CP","type":"number"}]
);
CREATE INDEX IF NOT EXISTS tables_by_sheet ON tables(sheet_id);

-- One row of that table, as an object keyed by column. Schema-agnostic on purpose: a sheet
-- with three columns and a sheet with eighty-five both land here.
CREATE TABLE IF NOT EXISTS table_rows (
  id       TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  idx      INTEGER NOT NULL,
  r        INTEGER NOT NULL,                 -- the row in the sheet it was read from
  data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS table_rows_by_table ON table_rows(table_id, idx);
