-- The sheet inside the app. A board's rows stay the record — typed columns the month and
-- player views can query — and this holds one JSON snapshot of the workbook they were last
-- reviewed in: formatting, formulas, any scratch columns to the right. It is saved in the same
-- batch as the rows and thrown away whenever the rows change by any other route, so it is
-- never newer than the rows and never older than them either.
CREATE TABLE IF NOT EXISTS board_sheets (
  board_id   TEXT PRIMARY KEY,
  snapshot   TEXT NOT NULL,               -- Univer IWorkbookData, opaque to the Worker
  updated_at TEXT NOT NULL
);

-- Two officers with the same board open is the realistic conflict. A save carries the version
-- it was loaded at; a stale one is refused rather than silently overwriting the other's work.
ALTER TABLE boards ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
