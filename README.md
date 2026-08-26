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

Pick the recording → set the Date String → **Extract**. About twenty seconds. Then
**Copy for sheet** and paste into the alliance tab.

Names you resolve by hand, saved with **Remember my fixes**, match automatically from then
on. That list only grows, so the manual work shrinks toward nothing.

## Why it is built this way

Uploading the whole video is the thing that made the old flow slow, so the browser decodes
it locally and sends only sampled frames — roughly 800 KB instead of 250 MB.

Choosing *which* frames is the interesting part. A leaderboard is a run of near-identical
cards, which defeats the obvious approaches: whole-frame difference cannot tell a scrolled
screen from a still one, and matching one frame against another is genuinely ambiguous
because several offsets, exactly one card apart, fit equally well. So the page measures
only whether the list is moving, integrates that over the recording, and spends its frame
budget evenly across the total motion. A slow careful scroll and a fast flick then produce
the same coverage at the same cost.

The names are never transcribed and corrected. They are *resolved*: the model reads each
stylised tag and also writes it out in plain letters, and that plain form is fuzzy-matched
against the roster. `Ƥ€ΔĆĦ` and `𝟻𝙰𝙼` land on the right player without anyone retyping
anything.

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

## If a response gets cut off

Long batches can hit the output limit mid-object. Rather than discarding the batch, the page
parses row objects individually and keeps every complete one. Because frames overlap
heavily, a lost tail is picked up by the neighbouring frame anyway.

## Other providers

The page speaks three dialects: Gemini, Anthropic, and the OpenAI chat-completions shape
that almost everyone else implements. Picking one of the OpenAI-compatible providers fills
in its endpoint and a sensible model; **Other OpenAI-compatible** takes any base URL, so a
provider that does not exist yet still works without touching the code.

| provider | free vision | notes |
|---|---|---|
| **Gemini** | 20 requests/day | the default; measured 40/40 on a real recording |
| **OpenRouter** | ~50 requests/day | 8 free vision models, incl. `google/gemma-4-31b-it:free` |
| **Groq** | generous | very fast; Llama 4 Scout has vision |
| **Mistral** | free tier | Pixtral |
| **Anthropic** | paid | no free tier |

All of the above allow browser calls. **GitHub Models does not** — it sends no CORS headers,
so a static page cannot reach it at all.

Only Gemini has been measured on this task. The others are wired up and structurally
verified, but a smaller free model may well read the stylised names less reliably — check
one run against a sheet you trust before relying on it.

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
