# Kartz Extractor

A single static page that turns a screen recording of the in-game **Ranking** list into
rows you paste straight into the tracking sheet. No install, no OCR software, no server.
Works on Windows, macOS, Android and iOS — anywhere with a browser.

## Deploy to GitHub Pages

```bash
cd kartz-web
git init && git add -A && git commit -m "Kartz extractor"
git branch -M main
git remote add origin https://github.com/<you>/kartz.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Source: `main` / root**. The page appears at
`https://<you>.github.io/kartz/` a minute later. On a phone, use Share → Add to Home Screen
and it behaves like an app.

## First-time setup

Paste the link to the **Alliance Rosters** tab and press **Pull roster**. That is it — the
page reads the sheet itself and caches it, so nobody has to copy 828 rows, and nobody is
working from a stale copy after a new member joins. The sheet must be readable by link:
*Share → General access → Anyone with the link → Viewer*.

Then either paste your own API key, or — if your admin has set up the Worker below — pick
**Shared key (team Worker)**, enter the Worker URL and the shared phrase, and skip keys
entirely.

## Sharing one key with your officers

**A static page cannot keep a secret.** Anything `index.html` sends, a viewer can read out
of the browser's network tab in about ten seconds. Obfuscating a key in JavaScript is not
security, and a leaked key means anyone can spend your quota or run up your bill.

The real fix is for the key to live somewhere the browser never sees. `worker.js` is that:
a small Cloudflare Worker holding the key, which the page talks to instead of Google.

```bash
npm i -g wrangler && wrangler login
wrangler deploy
wrangler secret put GEMINI_KEY     # your key, at the prompt
wrangler secret put SHARED_PASS    # any phrase you hand your officers
```

Then edit `ALLOWED_ORIGINS` at the top of `worker.js` to your Pages URL and `wrangler deploy`
again. In the page, choose **Shared key (team Worker)**, give people the Worker URL and the
phrase, and they never touch an API key.

Two things gate it, because a public page in front of a public Worker is otherwise a public
API: requests must come from an origin you listed, and must carry the shared phrase. Status
codes pass through untouched so the model fallback chain still works through the proxy.

Cloudflare's free tier is 100,000 requests a day and needs no card. Your ceiling stays the
Gemini quota, not the Worker.

## Each run

Pick the recording, check the date, press **Extract**. Then **Copy for sheet** and paste.

The output is four columns, in this order:

| Date | Rank | Game Name | Kartz Points |
|---|---|---|---|
| 2026-08-26 | 1 | Neaira | 810 |

The date defaults to today and is always written `YYYY-MM-DD`. **Game Name** is the roster
name the player was matched to, not the decorated tag from the video — that is the form the
sheet's lookups need. Where a player could not be matched, the plain reading is used
instead. Rank is renumbered over the rows that actually ship, so it is always a gap-free
1..N and the on-screen table agrees with what lands in the clipboard.

## Alliances that get skipped

**Skip these alliances** defaults to `z3.?, z1.Transferred` and is applied when the roster
is pulled — of 828 rows, 689 are kept and 139 set aside.

Those 139 are not simply discarded, because deleting them would make things worse rather
than better: a transferred player who still appears in the recording would stop matching
anything and turn up in the review list as an unknown name, to be dealt with by hand every
single month. Instead they are kept to one side and used only for recognition. If one shows
up in a video the row is identified, greyed out with its alliance, marked **excluded**, and
left out of the copied rows. The count is stated up front — *2 excluded (z3.?,
z1.Transferred)* — so it is visible rather than silent.

Edit the field to change it; it is saved with the rest of the setup. Matching is
case-insensitive.

## Reading the results

- **exact / 92%** — matched to the roster, nothing to do.
- **confirm** — not in the roster. Either pick the right player from the dropdown, or leave
  it as a new player, or discard it if it is not a real row.
- **A coverage warning** means the game showed a rank higher than the number of rows that
  came through, so something was missed. Raise *Frames to send* and run it again.

Ties are common — several players often share a score — so the row order within a tie is
arbitrary. The sheet looks players up by name, so this does not matter.

## Errors, and why they stopped happening

Two different faults both used to surface as a red message, and both are now handled
without you seeing anything.

**503 "high demand"** is not about your key. It means that one model alias is saturated at
that moment. Probed side by side, `gemini-3.7-flash` returned 503 while six sibling models
answered normally in the same second.

**429** is the free tier's daily allowance — and the quota is named
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`. The important word is **PerModel**:
the 20-a-day is counted separately for every model, not shared across them.

So both faults have the same cure — ask a different model — and the page now does that
automatically, walking down a fallback chain and carrying on. It says which model it landed
on rather than hiding it. Verified by starting a run on a model whose daily quota was fully
exhausted: it fell through to the next and returned all 40 players with no error shown.

## How many runs you actually get

| | |
|---|---|
| models in the chain | 7 |
| free quota, per model, per day | 20 requests |
| **effective total** | **140 requests a day** |
| requests per run (24 frames, 8 per call) | 3 |
| **runs per day** | **about 46** |

Twelve runs — three scoring days across four alliances — is 36 requests. Done back to back
in a single hour that is roughly **a quarter of one day's free allowance**, on one key, with
no billing enabled.

The chain order is set by what held up under testing. `gemini-flash-latest` is deliberately
excluded: it returned 503 on every attempt across a whole session, then an empty body. The
lite models are quick — 5 seconds a batch against 18 — but one dropped a player, so they sit
below the full ones and are reached only when the better models are spent.

## What cropping does and does not do

Frames are cropped before sending: the title bar, margins and avatar column are dropped,
and the rank digits are spliced next to the name and score. Untick **Crop to the list** if
the preview strip ever looks wrong on a differently shaped phone.

It is worth being precise about why, because the obvious reason turns out to be false.
Cropping does **not** make the request cheaper. Measured against Groq with Qwen 3.6:

| image | pixels | tokens |
|---|---|---|
| 560x936 | 524,160 | 1807 |
| 280x468 | 131,040 | 1807 |
| 140x234 | 32,760 | 1807 |

Sixteen times fewer pixels, identical cost — billing is per image, not per pixel. Shrinking
or cropping frames to save money simply does not work here; the only real lever on a
token-metered tier is **sending fewer frames**.

What cropping actually buys is correctness and upload size. The game pins the viewer's own
rank in a card at the foot of every frame, so it repeats in every single image; it used to
be held off with a line in the prompt and a y-position guess, and now it is physically not
in the picture. The upload drops from about 36 KB a frame to 20 KB, which is worth having
on a phone connection.

## If a response gets cut off

Long batches can hit the output limit mid-object. Rather than discarding the batch, the page
parses row objects individually and keeps every complete one. Because frames overlap
heavily, a lost tail is picked up by the neighbouring frame anyway.

## Other providers

The page speaks four dialects: Gemini, Anthropic, the team Worker, and the OpenAI
chat-completions shape almost everyone else implements. Picking a provider fills in its
endpoint, model, batch size and pacing.

### Groq — Qwen 3.6 27B

The model itself is very good at this. Given a leaderboard screen it returned every row
with correct ranks and scores in **1.3 seconds**, and read `ᏢᎬᎪĆᎻ` as PEACH, `ᵇᵃᵗᵐᵃⁿ` as
batman and `ÈXÎLÉ` as EXILE without being asked twice. Accuracy is not the problem.

Throughput is. The free tier allows **8,000 tokens a minute**, and that budget counts the
output you *reserve*, not just what comes back — asking for 16k of output made a 5k request
weigh 19k and get refused outright with a 413.

Measured: the prompt is 383 tokens and a frame about 2,100. Three frames plus a 1,500-token
reservation comes to roughly 8,050 — just over the ceiling, and it fails on some recordings
and not others depending on how busy the picture is. Two frames with a 900-token reservation
lands near 5,400, which fits with room to spare. Three would be about 10% quicker across a
whole run and is not worth the intermittent failure.

| | Groq free (Qwen 3.6) | Gemini free |
|---|---|---|
| per request | ~5,400 tokens, 2 frames | 8 frames, 3 requests per run |
| one 24-frame run | **~8 minutes** | **18–24 seconds** |
| twelve runs | **~97 minutes** | **~5 minutes** |
| what limits you | 8k tokens/minute | 20 requests/day/model, ×7 models |

Groq's 1,000 requests a day is generous and its per-call latency is excellent; the minute
budget is what bites. The page handles it rather than failing: Groq batches run one at a
time instead of in parallel, and a 429 there is waited out using the server's own
`retry-after` hint, because unlike Gemini's daily cap a per-minute window genuinely clears.

Use it if you like the model or Gemini is down. For twelve runs in one sitting, Gemini is
roughly twenty times quicker.

| provider | free vision | notes |
|---|---|---|
| **Gemini** | 20/day per model, 7 models | default; measured 40/40 on a real recording |
| **Groq — Qwen** | 1000/day but 8k tokens/min | accurate and fast per call, slow in bulk |
| **OpenRouter** | ~50 requests/day | 8 free vision models |
| **Mistral** | free tier | Pixtral |
| **Anthropic** | paid | no free tier |

All allow browser calls. **GitHub Models does not** — it sends no CORS headers, so a static
page cannot reach it.

## Measured on a real recording

A 50-second recording of 40 players, run end to end in the browser:

| | |
|---|---|
| total time | 18–24 seconds |
| players found | 40 of 40 |
| points errors | none |
| matched to roster automatically | 28 |
| needing confirmation | 12 — all genuinely absent from the roster |
| sent to the API | ~800 KB, versus a 250 MB upload |

The model read `ᵇᵃᵗᵐᵃⁿ`, `尺乇爪爪`, `PΞΔĊĦ`, `GHÖS†` and `ÈXÎLÉ` correctly, including the
gold, silver and bronze medals that stand in for ranks 1 to 3.

## If it is slow

Thinking is disabled deliberately — reading a leaderboard is perception, not reasoning, and
leaving it on made a batch take 36 seconds instead of 8. `gemini-flash-latest` is often
overloaded and returns 503; `gemini-3.6-flash` is the default because it is reliable.
