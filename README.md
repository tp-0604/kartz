# Kartz Extractor

Screen recording of the in-game **Ranking** list → rows you paste into the tracking sheet.
Runs in a browser on any device. The recording never leaves your phone; only sampled frames
go to the model.

Live at `https://kartz.<your-subdomain>.workers.dev` (the old single page in `public/`), and the
new app under `web/` — see **The app** below.

---

## The app

The page is now a React application in `web/`, with a spreadsheet inside it. The workflow is

    recording → Extract → review the rows → Open in sheet → edit, format, add columns → Save
                                                              ↓
                                            Cloudflare Worker (worker.js) → D1

No CSV, no download, no Google Sheets in the middle. Four screens:

| screen | what it is for |
|---|---|
| **Extract** | the recording in, the rows out — unchanged logic, now in `web/src/extractor/` |
| **Sheet** | a workbook (Univer, Apache-2.0): formulas, formatting, sort, filter, undo/redo. Columns A–E are the record; anything to the right is kept with the sheet |
| **History** | every board saved: by month and day, one month across its days, one player over time, and **Import** for backloading past months from the Kartz Tracking workbook |
| **Roster** | the alliance's Google Sheet (`InputRoster`), pulled by link, with this database's corrections on top |

**Setup** (the ⚙ button) holds the shared phrase the Worker asks for when the page is hosted away
from it, and the roster pull.

### Running it locally

    npx wrangler dev --port 8787 --local      # the API, with a local copy of the database
    cd web && npm install && npm run dev      # the app at http://localhost:5173/kartz/

The dev server proxies `/api` to the Worker, so the two share an origin exactly as they do in
production. The first time, create the local tables:

    npx wrangler d1 execute kartz-db --local --file=schema.sql
    npx wrangler d1 execute kartz-db --local --file=migrate-002.sql

`http://localhost:5173/kartz/?demo=1` loads a few made-up rows into the review table so the
sheet and the save can be tried without a recording or a Gemini key.

### Backloading the old workbook

**History → Import → Whole workbook.** Download the tracking sheet from Google (*File → Download →
Microsoft Excel*) and drop the .xlsx on that screen. It is read in the browser — nothing is
uploaded — and nothing is written until you press Import. From the current workbook that is
**111 boards and about 15,600 scores across 14 months**.

Every tab named for a month is read, including the ones named for an alliance as well
(`North September 2025`) and the working copies (`north`, `central`, `FebNorth`). `InputRoster`
is not, because the app reads the roster live.

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

**History → Import → One tab** is still there for a single tab, by link or paste.

### The database

`migrate-003.sql` adds two things to an existing database and must be run once against the
real one before the new app is deployed:

    npx wrangler d1 execute kartz-db --remote --file=migrate-003.sql

- `board_sheets` — one workbook snapshot per board (formatting, formulas, scratch columns),
  saved in the same batch as the rows and dropped whenever the rows change any other way.
- `boards.version` — bumped on every write; a save from a stale copy is refused with a 409
  rather than silently overwriting another officer's work.

The scores stay in typed columns (`boards`, `scores`) — that is what the month and player views
query, and what the Apps Script pull reads. The snapshot is presentation, never the record.

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

### API

Everything the old page used still works. Added:

| | |
|---|---|
| `GET /api/boards/:id` | board, rows, and the sheet snapshot if there is one |
| `POST /api/boards` | create; `409` if it exists, unless `replace: true` |
| `PUT /api/boards/:id` | the sheet's save: rows as reviewed, the snapshot, and the `version` it was loaded at |
| `PATCH` / `DELETE /api/boards/:id` | relabel or delete (the old `/board` routes, path-style) |
| `POST /api/boards/:id/rows` | add or overwrite rows by rank |
| `PATCH` / `DELETE /api/boards/:id/rows/:place` | correct or remove one row |

Undo and redo live in the workbook and never reach the network; the database sees the sheet
only when Save is pressed, as one atomic replacement of the board. A draft is kept in the
browser two seconds after the last change, so a closed tab costs nothing.

---

## Each run

| | |
|---|---|
| **Step 1** | Record the Ranking list. Hold still a second at the top before scrolling — the first few ranks get the fewest frames. |
| **Step 2** | Open the site and choose the recording. On a phone this opens the camera roll. |
| **Step 3** | Check the date. It defaults to today. |
| **Step 4** | Press **Extract**. About 15 seconds. |
| **Step 5** | Glance at any rows marked *confirm* — tick the ones that look right, correct the rest. Usually a handful. |
| **Step 6** | Press **Copy for sheet**. |
| **Step 7** | Paste into the alliance tab. Four columns: Date, Rank, Game Name, Kartz Points. |

There is no CSV download step, no Split Text to Columns, and no name-fixing pass. The old
Step 8 — *"fix the name in column M, this step will take the most time"* — is what the roster
matching replaced.

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

**Once per device**, on the page: paste the link to your **Alliance Rosters** tab, press
**Pull roster**, press **Save setup**. The badge turns green with the roster count. The sheet
must be link-readable (*Share → General access → Anyone with the link → Viewer*).

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
which is nowhere near a button at the foot of it — *Copy for sheet* worked perfectly and looked
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
