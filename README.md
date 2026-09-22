# Kartz

A screen recording of the in-game **Ranking** list → rows in your Google Sheet.

Kartz is a Google Sheets add-on. It opens as a window over the spreadsheet, reads a recording
in the browser, matches what it finds against your roster tab, shows you the rows, and inserts
them into the tab you are standing on — without touching a formula, a colour or a dropdown that
is already there.

The recording never leaves the machine. Sampled frames go to a model through a Cloudflare
Worker, which holds the key; the video itself does not.

---

## What it looks like

```
Google Sheets
└─ Kartz ▸ Extract a recording
   └─ a modeless dialog, 760×548 — the sheet stays live underneath
      ┌───────────────────────────────────────────────────────┐
      │ ▣ TW 2698 — Kartz Tracking   September 2026 · 40 rows │
      ├──────────────────┬────────────────────────────────────┤
      │ roster: 12       │                                    │
      │ rows go to: end  │        ↑  Drop a recording         │
      │ model: ready     │                                    │
      ├──────────────────┴────────────────────────────────────┤
      │ Ready.                            [Ask about this tab] │
      └───────────────────────────────────────────────────────┘
```

Four steps, two presses: pick a recording, watch it read, look at what it found, send it. The
review grows the window to 900×648 and shows a real table — rank, roster name, in-game name,
alliance, score, and one word saying whether the sheet already has that row. Clicking a row
leaves it out. The last write can be undone.

Modeless is the point: the spreadsheet is not taken away from you while the window is up. You
can scroll it, switch tabs, and click a cell — and "where they go" will offer that cell.

---

## What it does to your spreadsheet

Five things, and nothing else.

| | |
|---|---|
| **Reads the roster** | A tab it finds by name (`Roster`, `Players`, …) or by headings that mention a name and an alliance. Pick it yourself in Settings if the guess is wrong. |
| **Reads the current tab** | Its headings, how far the rows go, and whether you may write to it. The heading row is the first row with two or more filled cells, so a title line above it is no problem. |
| **Finds duplicates** | Before anything is written, every candidate row is compared against what is already on the tab — on what the cells *show*, ignoring case, spacing and the fancy text the game draws. |
| **Inserts rows** | `insertRowsAfter`, then the formatting of the row above is copied onto them, then the values go in with `setValues` over a range exactly the size of the values. |
| **Preserves formatting** | A column no field is mapped to is written as an empty string, never skipped and never overwritten — so a formula column, a total, a dropdown, a conditional format or banding keeps working. Nothing here ever clears, formats or sorts anything. |

It also appends one line per extraction to a `Kartz log` tab, which is the only tab it will
create.

**Permissions are Google's.** There are no accounts. If you can edit the spreadsheet you can
extract into it; if you can only view it, the dialog says so and stops.

---

## Installing it

The script is **bound to your spreadsheet** — it is part of that file, not a Marketplace
add-on, so there is nothing to publish and nothing to review.

**By hand:** open the spreadsheet → Extensions → Apps Script. Create three files and paste in
`addon/Code.gs`, `addon/Sheets.gs` and `addon/Dialog.html` (the built one — see below). Set the
project's `appsscript.json` from `addon/appsscript.json` (Project Settings → "Show appsscript.json"),
then reload the spreadsheet. A **Kartz** menu appears next to Help.

**With clasp**, which is less typing every time:

```bash
npm install -g @google/clasp
clasp login
clasp clone <script id>      # Extensions → Apps Script → Project Settings → Script ID
cd web && npm run build      # writes addon/Dialog.html
clasp push
```

The first time you open the dialog Google asks you to authorise the script. It asks for two
things: the spreadsheet it is bound to (`spreadsheets.currentonly` — not all your files, this
one), and permission to show a window.

---

## The Worker

A page cannot hold a secret. The model key lives in a Cloudflare Worker instead, and the
spreadsheet proves itself with a shared phrase.

```bash
npx wrangler deploy
npx wrangler secret put GEMINI_KEY     # required: reading a recording
npx wrangler secret put SHARED_PASS    # required: the phrase the spreadsheet brings
npx wrangler secret put ANTHROPIC_API_KEY   # optional: asking questions about a tab
```

Then open **Kartz → ⚙ Settings** in the dialog, paste the Worker's address and the same phrase,
and press **Save and test** — it calls the Worker and tells you which model answered.

The phrase is kept in the spreadsheet's own properties, so everyone who opens the file gets the
same setup and nobody types it twice. It is handed to the dialog's page, which needs it: the
frames go from the browser straight to the Worker. That is as private as the spreadsheet is —
only somebody who can already edit the file can open the dialog at all.

The Worker answers nothing without the phrase, and answers a preflight only for the
`googleusercontent.com` page Google serves the add-on from. With no `SHARED_PASS` set it refuses
everyone, rather than being an open AI proxy for whoever finds the URL.

---

## Asking about a tab

**✦** opens a question box. The rows on the tab you are standing on travel with the question
(up to 300 of them, as they are displayed), the Worker asks the model, and the answer comes
back as a sentence and a few figures. Nothing is stored anywhere: the spreadsheet is the data,
which makes every answer exactly as current as the sheet is.

Because the dialog is modeless, "this tab" means whichever tab you are on when you press Ask.

---

## Developing

```bash
cd web && npm install
npm run build                 # → addon/Dialog.html, everything inline, one file
node ../tools/serve-dialog.mjs   # http://localhost:8788
```

The demo server draws a mock of Sheets with the dialog floating over it at the real pixel
sizes, and has buttons for each step — `start`, `reading`, `review`, `done`, `ask`, `settings`.
Outside Apps Script there is no `google` object at all, so `web/src/dialog/bridge.js` answers
from a small stand-in spreadsheet and the whole dialog can be built without leaving the machine.
The dialog says so, in as many words, when it is running against the stand-in.

```bash
node test/run.mjs
```

Three suites: the Worker's door, what the model does when a provider is busy, and which column
on a spreadsheet holds what.

### The shape of it

```
addon/            what gets pushed to the script project
  Code.gs           the menu, the window, the settings
  Sheets.gs         everything that touches the spreadsheet
  Dialog.html       built — do not edit
web/src/
  dialog/           the window: Dialog, ReviewTable, Settings, AskPanel, bridge, fields
  extractor/        frames → model → rows → roster matching (unchanged)
  styles/           tokens.css (the palette), dialog.css (the window)
worker.js           the door: the phrase, the model proxy
worker/ai/          asking about a tab
```

---

## Before this

This repository used to hold a whole spreadsheet application — accounts, a D1 database, a file
browser, an editable grid, imported workbooks. It was retired in favour of living inside Google
Sheets, which people were using anyway. The code is in the history if it is ever wanted; the
data it held was exported first.
