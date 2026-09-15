-- Formatting comes back.
--
-- Run once, against an existing database:
--   npx wrangler d1 execute kartz-db --remote --file=migrate-007.sql
--
-- The spreadsheet this replaced could fill a cell, bold it, colour its text. That is how people
-- mark a board up while they are working through it — this one is checked, that one is in
-- dispute, these three are the ones to chase — and losing it lost a way of working, not a
-- decoration.
--
-- It lives on the row, beside `extra`, for the same reason `extra` does: the row has an id that
-- nothing edits, so a fill follows its player through a sort, a filter, a rank correction and a
-- re-extraction. A separate table keyed by position would not.
--
-- What is stored is a swatch name, not a colour: "yellow", not "#faf0c8". The grid resolves it
-- against the theme, so a board marked up in daylight is still readable at night — which a
-- stored hex could not manage.
ALTER TABLE scores ADD COLUMN style TEXT;
ALTER TABLE roster ADD COLUMN style TEXT;
