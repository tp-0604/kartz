-- Files, sheets, and the grid itself.
--
-- Run once, against an existing database:
--   npx wrangler d1 execute kartz-db --remote --file=migrate-009.sql
--
-- Nothing is deleted or rewritten. Eight tables are new; the boards, scores and roster that are
-- already here are untouched, and move into this tree in their own step later.
--
-- The shape of it: a folder holds files, a file holds sheets, and a sheet's grid is kept as
-- compressed slabs of five hundred rows each. None of these tables has a column named after
-- anything in the game, because the files in question have no schema in common — one has
-- eighty-five columns of event attendance and the next is a calendar drawn in merged cells.
--
-- What is queryable comes from the projection at the bottom: where a region of a sheet really
-- is a table, its rows are written out as JSON objects that the analyst and the filters can
-- read. A sheet that is a drawing gets no projection, because there is nothing there to ask.

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
