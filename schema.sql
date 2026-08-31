-- One row per player per scoring day. Long format, not wide: the monthly tabs in the
-- spreadsheet grew a new column every scoring day and a new shape every few months, which is
-- why five different parsers are needed to read two years of them back. A row that carries its
-- own date and alliance never needs the table reshaped again.
CREATE TABLE IF NOT EXISTS scores (
  run_id   TEXT    NOT NULL,   -- date|alliance: re-uploading a run replaces it rather than doubling it
  date     TEXT    NOT NULL,   -- ISO, as pasted into the sheet
  alliance TEXT    NOT NULL,
  place    INTEGER NOT NULL,   -- the rank the game showed
  search   TEXT,               -- roster name, column A. NULL for a player not on the roster yet
  ingame   TEXT    NOT NULL,   -- the name as the video drew it
  points   INTEGER NOT NULL,
  PRIMARY KEY (run_id, place)
);

-- History for one player is the whole point, and it is looked up by the stable name rather
-- than the in-game one: players rename constantly, which is most of what the matching fights,
-- and keying on the drawn name would fragment one player into six across two years.
CREATE INDEX IF NOT EXISTS scores_by_player ON scores(search, date);
CREATE INDEX IF NOT EXISTS scores_by_date   ON scores(date, alliance);
