-- The roster moves into the app.
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

-- roster_edits is left where it is. It held the differences against the sheet, it has been
-- folded into the rows above, and nothing writes to it again.
