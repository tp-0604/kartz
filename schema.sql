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

CREATE TABLE IF NOT EXISTS scores (
  board_id TEXT    NOT NULL,
  place    INTEGER NOT NULL,            -- the rank the game showed
  search   TEXT,                        -- roster name: the identity. NULL for somebody new
  ingame   TEXT    NOT NULL,            -- what the video drew, kept because it changes
  alliance TEXT,                        -- the player's OWN alliance, from the roster
  points   INTEGER NOT NULL,
  edited   INTEGER NOT NULL DEFAULT 0,  -- a person corrected this row; a re-save must not undo it
  PRIMARY KEY (board_id, place)
);

-- Alliance is stored twice and the two answer different questions. boards.alliance is which
-- board was filmed; scores.alliance is whose player this is. The recording of 27 August was
-- 120 players from 698W and 32 from elsewhere, so a single column would have filed Duke under
-- 698W permanently while the roster said 698S — and "how did 698S do in September" would have
-- quietly lost him a year later, with nothing about the table looking wrong.

CREATE INDEX IF NOT EXISTS scores_by_player   ON scores(search);
CREATE INDEX IF NOT EXISTS scores_by_alliance ON scores(alliance);
CREATE INDEX IF NOT EXISTS boards_by_date     ON boards(event, date);

-- One workbook snapshot per board: the sheet the rows were last reviewed in, with its
-- formatting and formulas. Saved with the rows, dropped when the rows change any other way.
CREATE TABLE IF NOT EXISTS board_sheets (
  board_id   TEXT PRIMARY KEY,
  snapshot   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

--
-- It lived in a Google Sheet tab and was pulled from it, with this database holding only the
-- differences. That made the sheet the record and the app a reader of it, which is backwards
-- now that the roster is maintained here: there is one list, it is these rows, and nothing has
-- to be pulled from anywhere.
--
-- Same shape as a board: typed columns are the record, and the workbook the user edited them
-- in is filed beside them so formatting and column widths survive. A row's identity is its
-- search name, which is what scores.search has always pointed at.
CREATE TABLE IF NOT EXISTS roster (
  search     TEXT PRIMARY KEY,            -- the identity; scores.search is the same string
  ingame     TEXT NOT NULL,               -- the name as the game draws it
  alliance   TEXT,
  extra      TEXT,                        -- JSON, keyed by column heading: CP, march types, notes
  sort       INTEGER NOT NULL DEFAULT 0,  -- the order the rows were left in
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS roster_by_alliance ON roster(alliance);

-- One row, holding what belongs to the list rather than to any player: which columns it has,
-- the workbook it is edited in, and a version so two officers cannot silently overwrite.
CREATE TABLE IF NOT EXISTS roster_meta (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  columns  TEXT NOT NULL DEFAULT '[]',    -- JSON array of headings past Alliance, in order
  labels   TEXT NOT NULL DEFAULT '[]',    -- JSON array of the three fixed headings, as titled
  snapshot TEXT,
  version  INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT
);
INSERT OR IGNORE INTO roster_meta (id, columns, labels, version) VALUES (1, '[]', '[]', 0);

