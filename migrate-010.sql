-- A face for every tab.
--
--   npx wrangler d1 execute kartz-db --remote --file=migrate-010.sql
--
-- One column. A cover is the tab seen from far enough away that a cell is a pixel — the fills
-- it really has, drawn from its own cells — and it is what the rail, the section wall and the
-- file list show instead of an icon. About three kilobytes a tab, computed once where the file
-- is read, because a browser should not pull a grid down to draw a thumbnail of it.
ALTER TABLE sheets ADD COLUMN cover TEXT;

-- How much a tab is worth looking at, so a file's face can be picked without reading every
-- cover: the number of distinct fills it uses, weighted above how much of it is filled.
ALTER TABLE sheets ADD COLUMN face INTEGER NOT NULL DEFAULT 0;
