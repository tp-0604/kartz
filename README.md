# Kartz Extractor

Screen recording of the in-game **Ranking** list → rows you paste into the tracking sheet.
Runs in a browser on any device. The recording never leaves your phone; only sampled frames
go to the model.

Live at `https://kartz.<your-subdomain>.workers.dev`

---

## Each run

| | |
|---|---|
| **Step 1** | Record the Ranking list. Hold still a second at the top before scrolling — the first few ranks get the fewest frames. |
| **Step 2** | Open the site and choose the recording. On a phone this opens the camera roll. |
| **Step 3** | Check the date. It defaults to today. |
| **Step 4** | Press **Extract**. About 15 seconds. |
| **Step 5** | Deal with any rows marked *confirm* or *contested* — see below. Usually a handful. |
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
| **exact** / a percentage | matched to the roster, nothing to do |
| **confirm** | not in the roster — pick the right player, or leave it as a new one |
| **contested** | two rows both resolve to one roster entry, usually a main and an alt sharing a display name. Neither is emitted until you choose. |
| **excluded** | in a filtered alliance, left out of the copied rows |

A **coverage warning** means the game showed a higher rank than the number of rows that came
through, so players were missed. Raise *Frames to send* and run again.

---

## What it does for you

**Pulls the roster from the sheet.** No pasting 828 rows, and it cannot go stale.

**Sends the roster with the request.** The model is asked *which of these players is this*
rather than *what does this say*, which is why stylised names resolve — `ŊŲƁĮ` → Nubi,
`ɬąŋʝıཞơ` → Tanjiro, `xØ₲x` → OG. Both the sheet name and the in-game name are supplied,
because for 40% of the roster they differ and some pairs no spell-check could bridge
(`ERank` is Aalonsoj ALT).

**Groups readings by rank, not by name**, then votes on the name within each rank. A name
read three ways stays one player instead of becoming three.

**Crops to the moving part of the screen**, which is the list — so the pinned "your own rank"
card at the foot is physically not in the picture, and neither is the surrounding game UI.
Works on any phone shape, because it is found rather than assumed.

**Drops rows from other screens.** The opening seconds often show something else; scores far
outside the list, or at zero, are discarded. The phone's music widget once arrived as a
player called "Not Playing".

**Search box instead of a dropdown.** Type a few letters; the list filters, stays about 210
pixels tall and scrolls inside itself. **New player** sits at the top, above a rule, with the
roster below. Arrow keys and Enter work.

**Alliance dropdown** on unconfirmed rows, for saying which alliance a new player belongs to.

**Remember my fixes** stores the name and the alliance together, so anything you resolve by
hand is matched automatically from the next run onward. That list only ever shrinks.

**Filter rows** defaults to `z3.?, z1.Transferred`. Those players are recognised but left out
of the copied rows, rather than deleted — so they do not come back every month as unknowns.

---

## Settings

**Frames to send** (default 48) is the only control. More frames means better coverage of a
long list and more sightings to vote on; fewer is quicker. The banner tells you if the list
came up short.

Model is `gemini-3.5-flash-lite`, fixed, with no fallback chain — a run either works or says
why.

---

## Measured

A 43-second recording of a 153-player list:

| | |
|---|---|
| players found | **153 of 153** |
| matched to the roster | **143** (93%) |
| needing a decision | 10 |
| time | 13 seconds |
| coverage warning | none |
