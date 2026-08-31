-- The first shape held one table called scores, carrying date and alliance on every row.
-- Move what is there into the two-table shape without losing it.
ALTER TABLE scores RENAME TO scores_v1;

CREATE TABLE boards (
  id TEXT PRIMARY KEY, event TEXT NOT NULL DEFAULT 'kartz', date TEXT NOT NULL,
  alliance TEXT NOT NULL, label TEXT, saved_at TEXT NOT NULL
);
CREATE TABLE scores (
  board_id TEXT NOT NULL, place INTEGER NOT NULL, search TEXT, ingame TEXT NOT NULL,
  alliance TEXT, points INTEGER NOT NULL, edited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, place)
);

INSERT INTO boards (id, event, date, alliance, label, saved_at)
SELECT DISTINCT 'kartz|' || date || '|' || alliance, 'kartz', date, alliance, NULL, date
  FROM scores_v1;

-- alliance is left NULL for the migrated rows: the old table only ever held the board's
-- alliance, and guessing the player's from it is exactly the conflation being fixed.
INSERT INTO scores (board_id, place, search, ingame, alliance, points, edited)
SELECT 'kartz|' || date || '|' || alliance, place, search, ingame, NULL, points, 0
  FROM scores_v1;

DROP TABLE scores_v1;

CREATE INDEX scores_by_player   ON scores(search);
CREATE INDEX scores_by_alliance ON scores(alliance);
CREATE INDEX boards_by_date     ON boards(event, date);
