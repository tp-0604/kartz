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
  saved_at TEXT NOT NULL
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
