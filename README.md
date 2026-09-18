# Kartz

Screen recording of the in-game **Ranking** list → rows in a database you can work in.
Runs in a browser on any device. The recording never leaves your phone; only sampled frames
go to the model.

---

## The app

One canvas, and two sheets over it.

    BOARDS — the canvas
    a month: alliances down the side, the days boards were filmed across the top
         │ drop a recording                    │ open a board, the roster or a view
         ▼                                     ▼
    EXTRACT sheet                              WORKSPACE sheet
    recording → rows → review → add            edit, search, filter, sort, import,
                         ↓                     export, ask, open in spreadsheet
                    Cloudflare Worker → D1

**The canvas** is where the app opens. The month is a grid of tiles, one per board, with a dashed
gap wherever an alliance was not captured, so what is missing is visible before anything is
opened. Its columns are the real dates boards were filmed on rather than fixed Day 1 / Day 4 /
Final slots, because some months hold two events. The roster and the views that cross boards sit
under it; the menu and `⌘K` reach everything from anywhere.

**The extractor sheet** is the recording coming in: drop a video anywhere on the canvas, or
choose one. Unchanged logic, in `web/src/extractor/`: the same frame sampling, the same prompt,
the same roster matching, the same one-character rule, the same review table. The reviewed rows
go into the database, with a preview first saying what is new and what is already there.

**The workspace sheet** is everything saved. A dataset is the roster or one board's scores, and it
opens as a grid: row numbers, a frozen header, multi-cell selection, editing, copy/cut/paste,
insert, delete, duplicate, resize, reorder, sort, filter, search, hidden columns, undo and redo.
The views that cross boards open here too — a month across its scoring days, one player over
time, the extraction runs, the activity trail — and, where a model provider is configured, an
analyst that answers questions by querying the database. Where the grid is not enough, **Open in
spreadsheet** loads Univer: what changes in the rows saves like any other edit, and the workbook
itself (formulas, merges, number formats) is kept beside the board for as long as the rows are
unchanged elsewhere.

A sheet that is put away stays open underneath, so an unsaved edit or a finished extraction is
never lost by going back to the canvas. The look is glass over solid rows, in light and dark; the
device decides unless a theme is chosen in the app.

### Accounts and permissions

Everyone signs up on first open: an in-game name, written plainly (letters, numbers, spaces and
`- _ . '`, no fancy text), and a password. A name belongs to one account however it is typed, so
"Amy" is one person everywhere. An admin signs up the same way and brings the admin code, a Worker
secret (`wrangler secret put ADMIN_CODE`); without it set, admin sign-up is refused.

The Worker enforces all of it — the page only avoids offering what would be refused:

- **Everyone** can browse every board, ask the AI, extract new boards (which are then theirs), and
  edit cells, rows and columns in the grid on any board.
- **Whoever sent a board** can delete it, rename or re-date it, and replace it with a new
  extraction. Boards from before accounts have no sender, so those are an admin's.
- **Admins** can do all of that on every board, open and save the spreadsheet engine, replace the
  roster or a whole board from an import, import a whole workbook, and change who owns a board.

Every save is logged under the name of whoever made it, with the values before and after. Every
five minutes a cron trigger turns each editing session that has gone quiet — one person, one
board, three minutes with nothing new — into one sentence in the log, written by the cheapest
configured model, or as a plain sentence when there is none.

### The AI bar

One box in the top bar, and ⌘J, opens the analyst from anywhere. It knows which board is open and
under what filters, answers by querying the database with a fixed set of tools, and draws the
answer with the app's own figures, tables and charts. Under each answer is what it cost, as the
provider counted it. A lookup shows the model at most 50 rows: a 200-row result is about 11,000
tokens, re-sent on every round after it, and fifty is plenty to answer from.

### The grid

Editing is optimistic and batched. A keystroke lands in the rows immediately, becomes an
operation in a queue, and the queue goes to the Worker a moment later as one batch — so pasting
fifty rows is one request, not fifty. The version the copy was loaded at rides along, so a save
made against somebody else's newer copy is refused rather than landing on top of it, and you are
asked what to do about it.

Nothing is thrown away quietly:

| | |
|---|---|
| a cell the Worker refused | keeps what you typed, is outlined in red, and says why |
| a queue that has not been sent | is written to this browser two seconds after the last change |
| a conflict | offers *take theirs, then re-apply mine* or *throw mine away* |
| a failed save | keeps the changes on screen and offers **Retry** |

Keyboard: arrows, shift-arrows, `Tab`, `Enter`, `Home`/`End`, `PageUp`/`PageDown`, `⌘/Ctrl`
with arrows to jump to an edge, `⌘/Ctrl+A`, `C`, `X`, `V`, `Z`, `⇧Z`, `F` for find, `S` to flush
the queue now, `Alt+Enter` for a new row, `Delete` to clear, `F2` or a double-click to edit, and
typing over a cell replaces it. Right-click for the rest.

### Marking cells up

Fill, text colour, **bold**, *italic*, underline and alignment, on whatever is selected —
`⌘/Ctrl+B`, `I` and `U`, or the toolbar's **Fill** menu for the rest. **Clear formatting** takes
it all off, and undo covers it like any other edit.

Two things about it are deliberate:

*It belongs to the row, not to the position.* A yellow row stays yellow through a sort, a
filter, a rank correction and a second extraction of the same day, because the marking is stored
against the row's id.

*A colour is a name, not a hex.* You pick from nine fills and eight text colours rather than
from a picker, and the name is what is stored: the theme decides what "yellow" is, so a board
marked up in daylight is still legible in dark mode. Every pair was checked on both surfaces —
normal text reads at 10:1 or better on every fill. A picker would let anyone choose white on
white, or a fill that disappears the moment the theme flips.

Font family and size are not offered. Both change how tall a line wants to be, and the grid
draws every row at the same height to stay fast at thirty thousand rows, so a larger font would
be clipped rather than honoured. Weight, slant, colour and alignment all fit inside a fixed row.

Marking a cell is not the same as correcting it: it does not set the row's *edited* flag, so a
row you only highlighted is still replaced by a later extraction, while a row whose value you
changed is not.

### The roster

The roster is the list of players, kept here and edited as a dataset like any other. Add a
player by typing a row, remove one by deleting the row, paste a block in from anywhere. The
identity every score points at is the **Player** column; **Name in video** is what a recording
is matched against; **Alliance** is optional. Every other column is the roster's own and is kept
without being read — including the ones that came over from Google Sheets.

Two rows cannot share a player name, and the API refuses the one row rather than the whole save,
naming the row it clashes with.

### Columns

A board's five typed columns are the record: **Rank**, **Player**, **Name in video**,
**Alliance**, **Kartz Points**. Everything to the right of them is yours — a note, a CP figure,
a legacy column — stored on the row under its own heading and never interpreted. Add, rename,
hide, resize and reorder from the **Columns** menu or by dragging a heading.

An older version of this app kept those extra columns inside a spreadsheet snapshot that only
one library could read. The first time a board is opened they are read out of that snapshot and
into the rows, and the board is marked so it is only done once. Fills and bold from that
snapshot come across too, each colour snapped to the nearest of the nine swatches by hue, so a
board somebody had highlighted stays highlighted. The snapshot itself is left where it is.

### Asking the data

A question is answered by *querying* the database, never by sending it to a model:

    question → the model picks tools → the Worker runs them against D1 → the model writes an
    analysis in a fixed shape → the browser draws it with its own components

The model gets a fixed set of tools — `list_datasets`, `get_dataset_metadata`, `query_records`,
`aggregate_records`, `compare_datasets`, `get_trend`, `get_player_history`, `search_players`,
`get_workspace_context` — and every argument is checked against columns that actually exist
before a statement is built. It never writes SQL, and the only column names that reach a query
are ones the Worker already knew about. Aggregation happens in SQLite: "average power by
alliance" is one `GROUP BY` returning four rows, not fifteen thousand rows and a hope.

The answer comes back as an object in a fixed shape — a title, a summary, and some combination
of metrics, tables, lists, bar charts, line charts and comparisons — which is validated and then
drawn by components this app owns. No HTML, no code, no markup of any kind crosses that line.
Each answer says whether every figure came from a query, what it was computed from, and what it
asked; **View source data** takes the workspace to those rows. Where the data does not exist it
says so rather than estimating.

It knows what is on screen: the dataset, the filters, the sort, the visible columns and how many
rows are selected — so "the average level of these players" means the ones your filters left.

The whole thing is optional. With no provider configured the bar says so and everything else
works exactly as it did.

### Running it locally

    npx wrangler dev --port 8787 --local      # the API, with a local copy of the database
    cd web && npm install && npm run dev      # the app at http://localhost:5173/kartz/

The dev server proxies `/api` to the Worker, so the two share an origin exactly as they do in
production. The first time, create the local tables:

    npx wrangler d1 execute kartz-db --local --file=schema.sql

`http://localhost:5173/kartz/?demo=1` loads a few made-up rows into the review table, so the
path from a recording to the database can be walked without a recording or a model key.

**Without Cloudflare at all.** `test/serve.mjs` runs the real Worker over an in-memory SQLite
database and serves the built app beside it, which is enough to use and test everything but the
model calls:

    cd web && BASE_PATH=/ npm run build
    node test/serve.mjs                        # http://localhost:8788/

### Tests

    node test/run.mjs

Runs the Worker's routing, the data layer, the version and conflict handling, the legacy
snapshot recovery, the controlled query tools and the .xlsx writer — against a real SQLite
database standing in for D1. No account, no network, no dependencies beyond Node.

The two browser suites need the app built, `npm i playwright`, and the local server above:

    node test/serve.mjs &
    node test/browser.test.mjs                 # the workspace, the grid, editing, undo, paste
    node test/stub-model.mjs &                 # a stand-in provider on :8799
    AI_PROVIDER=openai OPENAI_API_KEY=x AI_GATEWAY=http://localhost:8799 node test/serve.mjs &
    node test/browser-ai.test.mjs              # the analyst, the tools, the charts, the validation

`PLAYWRIGHT_CHROME` points at a browser already on the machine if you have one.

### Backloading the old workbook

**Import → The whole tracking workbook.** Download the tracking sheet from Google (*File →
Download → Microsoft Excel*) and drop the .xlsx on that screen. It is read in the browser —
nothing is uploaded — and nothing is written until you press Import. From the current workbook
that is **111 boards and about 15,600 scores across 14 months**.

Every tab named for a month is read, including the ones named for an alliance as well
(`North September 2025`) and the working copies (`north`, `central`, `FebNorth`). `InputRoster`
is not, because the app keeps the roster itself.

**Dates.** A month tab records Day 1, Day 4 and the Final and never says which days those were.
Three months are dated by the workbook itself, in the rows the extractor wrote into `north` and
`central`: 23 March, 27 April and 25 May 2026. Every one of those Day 1s is **the fourth Monday
of its month**, and Day 4 and the Final are three and six days after it — the `north` tab labels
its own three columns Day 1, Day 4 and Day 7. So every other month is *offered* its fourth
Monday, with the date shown against the month and editable before you import. Eleven of the
fourteen months are dated that way and are worth a glance.

**Two tabs describing one board are joined, not fought over.** February's main tab lost its 698N
scores and the `FebNorth` copy has them; the March 698N scores exist only in a second table
sitting to the right of the `north` tab. A board is every player either tab recorded, and where
both hold the same player the tab with the game's own ranks is believed.

Parked alliances (`z1.Transferred`, `z3.?`) and boards of one or two stray cells are left out;
both are listed under *What was left out* with the threshold to change.

**Import → A table into this dataset** takes a spreadsheet or a pasted block into whichever
dataset is open, showing the columns it found, what it would map them to, how many rows it would
create and what it thinks is wrong with them. A column this dataset does not have can be added as
a column of its own rather than dropped.

### Export

**CSV** or **XLSX**, of what is on screen, of every row, or of the rows you have selected. The
columns are the visible ones in their current order, so the file matches what you were looking
at — and a column the app has never understood goes out under its own heading like any other.

Nothing writes the .xlsx but this repository: it is a zip of five small XML files, and `fflate`
— already here for reading — zips it.

### The database

Cloudflare D1, and it is the record. `schema.sql` is what a new database is; the migrations take
an existing one there in order. **`migrate-006.sql` and `migrate-007.sql` must be run once
against the real database, in that order, before this version is deployed:**

    npx wrangler d1 execute kartz-db --remote --file=migrate-006.sql
    npx wrangler d1 execute kartz-db --remote --file=migrate-007.sql

Nothing is deleted by either. 006 rebuilds `scores` and `roster` to carry a stable row id and a
bag of custom columns, with every existing row copied across; everything else it adds is new.
007 adds the one column that holds a row's marking, and adds nothing else.

| table | what it holds |
|---|---|
| `boards` | one per alliance per day filmed, with a `version` bumped on every write |
| `scores` | the rows: a stable `id`, the rank, the player, the drawn name, the alliance, the points, `extra` — the board's own columns, keyed by heading — and `style`, the marking |
| `board_meta` | which columns a board carries past the record, and how they are laid out |
| `roster` / `roster_meta` | the player list and its columns, in whatever order it keeps them |
| `extraction_runs` | which recording produced which rows, and how many were already there |
| `activity` | what changed, to what, when |
| `saved_views` | a filter, a sort and a set of columns, under a name |
| `board_sheets` | the workbook "Open in spreadsheet" saves for a board (formulas, formatting), with the board version it matches; handed back only while that version is current |

Why a row id. The grid edits rows, and a row's key used to be the thing being edited: a score
was keyed by `(board_id, place)` and a player by their name, so correcting a rank or a spelling
was a delete and an insert, and two rows swapping ranks could not be written at all. An id that
nothing ever edits makes an edit an edit.

### Hosting the app

Two ways; the build is the same.

**From the Worker** (simplest — one origin, no phrase needed): build the app and point the
assets binding at it.

    cd web && BASE_PATH=/ npm run build
    # wrangler.toml:  [assets] directory = "./web/dist"
    npx wrangler deploy

**On GitHub Pages**: `.github/workflows/deploy.yml` builds `web/` and publishes it at
`https://tp-0604.github.io/kartz/` on every push to `main`. Before the first run set the
repository variable `VITE_API_BASE` to the Worker's URL plus `/api`, set Pages → Source to
GitHub Actions, and give the Worker a `SHARED_PASS` (`npx wrangler secret put SHARED_PASS`) —
each officer types it once on the Setup screen. GitHub Pages on a private repository needs a
paid plan; on the free plan the repository must be public.

### Secrets

| | |
|---|---|
| `GEMINI_KEY` | **required** — the extractor's model. Also answers analytics questions if nothing better is set |
| `SHARED_PASS` | only needed when the page is hosted away from the Worker |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | optional — a stronger model for the analyst |
| `AI_PROVIDER` | `anthropic`, `openai`, `google` or `workers-ai`. Otherwise inferred from whichever key is set |
| `AI_MODEL` | overrides the provider's default |
| `AI_GATEWAY` | a Cloudflare AI Gateway base URL, for routing and observability |
| `SHEET_TOKEN` | optional — opens the read-only CSV route to a script that has no origin |

### API

| | |
|---|---|
| `GET /api/datasets` | the roster and every board, for the navigator |
| `GET /api/datasets/:key` | columns, rows and a version. `:key` is `roster` or `board:<id>` |
| `POST /api/datasets/:key/ops` | a batch of operations against that version — insert, update, delete, columns, layout |
| `POST /api/commit` | extraction → data. `mode: preview` writes nothing and says what would happen; `new`, `all` and `replace` commit |
| `GET /api/runs` | the extraction runs |
| `GET /api/activity` | what changed, and when |
| `GET` / `POST` / `DELETE /api/views` | saved views |
| `GET /api/ai/status` | whether a provider is configured, and which |
| `POST /api/ai/ask` | a question, the workspace context, and the answer |

Everything the old page used still works: `/api/boards`, `/api/boards/:id`, `/api/runs`,
`/api/board`, `/api/score`, `/api/month`, `/api/player`, `/api/all`, `/api/roster/rows` and the
read-only `/api/csv`. One route is gone: `/api/roster` held the *differences* against a Google
Sheet, and answers `410` now that the roster is these rows — the single page in `public/` still
extracts, but its roster half no longer applies.

---

## Each run

| | |
|---|---|
| **Step 1** | Record the Ranking list. Hold still a second at the top before scrolling — the first few ranks get the fewest frames. |
| **Step 2** | Open the site and choose the recording. On a phone this opens the camera roll. |
| **Step 3** | Check the date. It defaults to today. |
| **Step 4** | Press **Extract**. About 15 seconds. |
| **Step 5** | Glance at any rows marked *confirm* — tick the ones that look right, correct the rest. Usually a handful. |
| **Step 6** | Press **Add … to the data**. It says how many are new and how many are already there. |
| **Step 7** | Choose. Then the board is open in Data, and you are already looking at it. |

The recording has to be one this browser can decode, which in practice means H.264 in .mov or
.mp4 — what a phone records. A file it cannot open now says so straight away instead of sitting
on *decoding video…* for ever, and says what to do about it.

There is no copy, no spreadsheet tab, no CSV download, no Split Text to Columns and no
name-fixing pass. The old Step 8 — *"fix the name in column M, this step will take the most
time"* — is what the roster matching replaced; the old Steps 6 and 7 are what the database
replaced.

Four recordings at once is the same thing with the choosing done in advance: drop them all in,
pick an alliance for each, and every board is written before the next is decoded, so a failure
halfway leaves the earlier ones saved.

---

## Setting up

**Once ever**, in Cloudflare (Workers & Pages → your `kartz` project):

- **Settings → Domains & Routes → Enable `workers.dev`** — a Worker has no public URL until
  you do this.
- **Settings → Variables and Secrets → `GEMINI_KEY`** — required. The key lives here, never
  in anyone's browser.
- `SHARED_PASS` — optional. Only gates callers that are not the site itself: curl, scripts,
  other origins.

Pushing to `main` redeploys.

**Once per device**, only when the page is hosted away from the Worker: type the shared phrase
on the Setup screen. The badge turns green.

There is no roster to set up. It is kept in this app's own database and edited in Data; nothing
is pulled from a Google Sheet.

---

## Reading the results

| badge | meaning |
|---|---|
| **exact** | matched to the roster, nothing to do |
| **1 char** | one character off a single roster name — see below |
| **confirmed** | you ticked it: the name is right as the video drew it |
| **confirm** | not in the roster — pick the right player, or leave it as a new one |
| **excluded** | in a filtered alliance, left out of the copied rows — still editable, and naming somebody else brings the row back in with its rank |

A **coverage warning** names the ranks that were never captured. Everyone else keeps the
rank the game gave them, so a gap costs you those players and nothing else. It comes from
scrolling faster than the sampling could follow, so re-record that stretch more slowly if you
want it filled.

---

## What it does for you

**The same recording gives the same rows.** Every run used to differ a little, and the cause
was not where it looked. Frame extraction is exactly repeatable — three extractions of one
video produce 153 byte-identical frames — so the drift was entirely the model. Temperature 0
is not enough on its own: it only says *take the likeliest token*, and which token that is
still moves with how the request happens to be batched on Google's side. Two identical
requests came back 3,666 and 3,883 characters long.

Passing a fixed **seed** pins it. The same two requests then came back byte for byte
identical, and two complete runs of a 153-player recording now produce the same 153 rows with
no differences at all. That is worth as much as any accuracy fix: a run that goes wrong now
goes wrong the same way twice, and a fault you can reproduce is a fault you can chase.

**Pulls the roster from the sheet.** No pasting 828 rows, and it cannot go stale.

**Sends the roster with the request.** The model is asked *which of these players is this*
rather than *what does this say*, which is why stylised names resolve — `ŊŲƁĮ` → Nubi,
`ɬąŋʝıཞơ` → Tanjiro, `xØ₲x` → OG. Both the sheet name and the in-game name are supplied,
because for 40% of the roster they differ and some pairs no spell-check could bridge
(`ERank` is Aalonsoj ALT).

**Accepts a name that is one character off, when only one player is that close.** These
readings fail in a particular way: the model gets almost every glyph and argues about one.
`ŊŲƁĮ` came back as `DUBI`, `ḐUBĮ`, `ɳUBI` and `กUBI` on different runs, with `UBI` intact
every time. Similarity scoring could not use that — it rated `MiniMe` against Mexi ALT at
0.75 and `DUBI` against Nubi at 0.75 too, and one of those has to be rejected. Counting
edits separates them: one substitution against five. Names must be at least four characters
and exactly one player may be that close, so an ambiguous reading is put to you instead of
being guessed at. Rows matched this way are badged **1 char**.

It applies only to names written in stylised Unicode, because only those are unreliably read.
A name in ordinary letters is transcribed accurately, so a reading one edit from a roster
entry is not that player misread — it is somebody else, usually a new joiner. Allowing it
regardless put `Weezy` down as Peezy and `DARTH` as Dart on a second recording, and `Weezy`
turned out to be a real player on the transferred list.

**Tolerates glyph drift in names written in unusual scripts.** `᥇ꪖꪻꪑꪖꪀ` is batman spelled in
Tai Viet and Limbu — characters chosen to look like Latin letters, though their Unicode names
say otherwise (the "b" is LIMBU DIGIT ONE). Nothing can fold that to `batman`, so it matches
on its codepoints instead, and a reading may be a couple of glyphs out and still be believed:
in a six-glyph word, two wrong glyphs leave four agreeing. Below four glyphs nothing is
tolerated, because that is where emoji live and one codepoint is the whole name — a single
substitution turns 🐼 into 🦊.

**Never enters one player twice.** When two rows resolve to the same roster entry — usually a
main and an alt sharing a display name — neither keeps the match, and both go through under
the name the video showed, flagged for confirmation. The duplicate the sheet would have
double-counted never appears, and no question is put to you about which is which.

**Groups readings by rank, not by name**, then votes on the name within each rank. A name
read three ways stays one player instead of becoming three.

**Crops to the moving part of the screen**, which is the list — so the pinned "your own rank"
card at the foot is physically not in the picture, and neither is the surrounding game UI.
Works on any phone shape, because it is found rather than assumed.

**Drops rows from other screens.** The opening seconds often show something else, so a score
many times the median is discarded. A score of *zero* is kept: the foot of the board is
players who scored nothing all month, and treating zero as junk silently deleted five of them
in a row. A zero row has to carry a rank number to be believed — the phone's music widget,
which once arrived as a player called "Not Playing", had none.

**Search box instead of a dropdown.** Type a few letters; the list filters, stays about 210
pixels tall and scrolls inside itself. **New player** sits at the top, above a rule, with the
roster below. Arrow keys and Enter work. It lists and returns the **in-game** name — column B
— with the searchable name shown greyed beside it, and typing either one finds the player.

**Sends a picture of the symbol names.** Names made only of emoji or exotic script are drawn
onto a reference sheet and sent as the first image, with each player's roster name printed
underneath. That turns "is this a polar bear or a panda" into a comparison between two
pictures — and when the page is open on the phone that made the recording, the browser draws
the emoji with the same font the game used, so they are near enough identical. A bare 🐼 used
to come back as the player "Vyking"; the same row now reads 🐻‍❄️ correctly.

**Overlaps the bands by a whole row.** A row landing on the join between two bands used to be
cut in half in the one above and in half again in the one below, appearing whole in neither —
46 pixels of overlap against a row 143 pixels tall. That is what lost single ranks while their
neighbours arrived intact: the gaps read 54 and 60, not 54 through 60. Taller bands cost
nothing, since an image is charged a flat rate whatever its size.

**Sends each frame as three bands.** Every image costs the model about the same 1090 tokens
whatever its dimensions — enlarging a frame before sending it changes nothing, and 1x and 3x
come back identical. The budget is spent on whatever is in the picture, and a whole frame
spends most of it on rank numerals, avatars and *Contribution (Pt)* captions. Cut into three,
the same pixels get three times the attention at exactly the cost of sending three frames.
Rank 37's name is a lone emoji twenty pixels across: whole it read 🐼, in bands it read 🐻‍❄️.

**Picks the sharpest frame nearby.** A timestamp is a position in the scroll, not a promise
that the frame is readable. Mid-flick the names smear while the rank numbers — big, bold,
high-contrast — survive, so the row arrives with a confident rank and a nonsense name. Each
pick is now the centre of a short window and the sharpest frame in it is the one sent. On the
test recording sharp frames score about 15 on that measure and blurred ones about 7.

**Keeps the rank the game printed.** Renumbering rows by position looked tidier and was
quietly destructive: three players the sampling missed pushed every row beneath them up by
three, so Amp went into the sheet as 138 where the game plainly showed 142. The game's number
is now carried straight through, so a missed player costs you that player and leaves the
others alone.

**Believes a claim in proportion to how readable the name was.** A name in ordinary letters is
transcribed accurately, so a claim that disagrees with the reading is the model reaching for a
roster entry that is not there — HÊNK, absent from the roster, was being filed as LeeK. A name
in stylised Unicode is the reverse case: the transcription is the unreliable half. ŊŲƁĮ came
back as ŊŲƁĮ, Ḏṳḇị, ḐŲḂĮ, DUBI, 𝓡𝓑𝓙 and ṆḶḄḶ across six runs of one recording. So the bar
drops, but only when the drawn name and the roster entry are both stylised.

**Every row can be settled without typing.** A name that matched nothing already reads as the
video drew it, so the tick beside it says *that is right* — the text turns green and the row
leaves the confirm tally. The pencil changes any name at all; typing only searches, and the
row is not decided until you choose an entry or press Enter, so an edit opened by accident
costs nothing — click anywhere outside and it goes back exactly as it was, half-typed letters
and all. The ✕ at the far right throws a row out and turns into ↺ to bring it back, keeping
whatever name you had chosen.

**Buttons say what they did.** Every action reported itself in the log at the top of the page,
which is nowhere near a button at the foot of it — the copy button worked perfectly and looked
exactly like nothing happening. Buttons now dip when pressed, and one that finishes something
turns green and says so for a second and a half: *Copied 132 rows ✓*, *Remembered 3 ✓*,
*Saved ✓*.

**One alliance for the whole run**, chosen at the head of the Alliance column. A recording is
of a single alliance's board, so answering that per row was a hundred-odd answers to one
question. It starts on *as found* — each row showing whatever the roster knows about that
player — and choosing an alliance sets every row to it. Choosing *as found* again puts them
back. The choice is filed with the name by **Remember my fixes**, so a new player is
recognised next month as one of yours.

**Remember my fixes** stores the name and the alliance together, so anything you resolve by
hand is matched automatically from the next run onward. That list only ever shrinks. Names
made of emoji can be taught too — they fold to nothing, so they used to be filed under a blank
key, each overwriting the last and none ever found again.

**Filter rows** defaults to `z3.?, z1.Transferred`. Those players are recognised but left out
of the copied rows, rather than deleted — so they do not come back every month as unknowns.

---

## Settings

There are none left to set, and the frame count is no longer a number someone chose. The
allowance that binds is **tokens**, not requests: an image costs a flat ~1,100 whatever its
dimensions, so the picture count is the whole budget. The roster is sent with every request
and it grows — 858 names to 883 in a day — and each name inflates six prompts at once. A run
sized by hand measured 243,000 against a limit of 250,000: inside it, but with no room to grow
into and nothing to warn anyone.

So the images are whatever is left once the prompts are paid for, and the sample points follow
from that. At 883 names it works out to 53 frames and about 201,000 tokens, leaving 48,000
spare; as the roster grows the sampling thins slightly rather than the run failing.

Three quarters of those points are spaced by accumulated motion, which follows the scroll
rather than the clock. The rest are spread evenly by time, because motion pacing has a blind
spot exactly where it hurts: a stretch where nothing moves accumulates nothing and takes a
single frame, and that stretch is the top of the list, held steady before scrolling begins.
Read once, ranks 1 to 3 came back with their scores written into the name field and nothing to
outvote them.

Six requests, not four. Fewer would save the roster prompt that rides along with each one, but
47 images to a request instead of 31 dropped the match rate from 91 of 129 to 67. A long batch
is attended to worse than a short one, and 14,000 tokens is not worth that.

Model is `gemini-3.5-flash-lite`, fixed, with no fallback chain — a run either works or says
why.

---

## Measured

A 43-second recording of a 153-player list:

| | |
|---|---|
| players found | **153 of 153** |
| ranks matching the game | all — checked against the recording at 142 and 143 |
| matched to the roster | **141** (92%) |
| needing a decision | 10, and all ten are genuinely new players |
| wrong matches | none |
| time | 13 seconds, 6 requests, 201K of the 250K-per-minute allowance |
