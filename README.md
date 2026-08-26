# Kartz Extractor

A single static page that turns a screen recording of the in-game **Ranking** list into
rows you paste straight into the tracking sheet. No install, no OCR software, no server.
Works on Windows, macOS, Android and iOS — anywhere with a browser.

## Where to host it

One Cloudflare Worker serves both halves: the files in `public/` are the site, and `/api/*`
runs `worker.js`. Same origin, one deploy, nothing to keep in step.

That arrangement is what makes Cloudflare Workers AI usable at all. Its REST API cannot be
called from a browser — the preflight comes back 405 with no allow-origin header — so the
call has to happen server-side. Here it does, and no token ever reaches the page.

### Deploy

Connect the repo at **dash.cloudflare.com → Workers & Pages → Create → Workers**, or from a
terminal:

```bash
npm i -g wrangler && wrangler login && wrangler deploy
```

Then, in the project:

- **Settings → Domains & Routes → Enable `workers.dev`.** A Worker has **no public URL until
  you do this** — the Overview will say *No URLs enabled*. Afterwards the site is at
  `https://kartz.<your-subdomain>.workers.dev`.
- **Bindings → Workers AI**, variable name `AI` (needed for the Cloudflare models).
- **Settings → Variables and Secrets** → `GEMINI_KEY` if you also want the Gemini path, and
  `SHARED_PASS` if the URL might be found by someone you did not give it to.

Pushing to `main` redeploys.

### Hosting the page somewhere else instead

`worker.js` also stands alone, for serving the page from GitHub Pages or any other static
host. Deploy it as its own Worker, add that page's origin to `ALLOWED_ORIGINS` at the top of
the file, and put the Worker URL in the page's endpoint box instead of `/api`. Note that a
different static host changes nothing about CORS — that is enforced by the service you call,
not by where the page came from.

### Who can use your deployment

A request is accepted if it comes from a browser origin the Worker recognises — its own, or
one listed in `ALLOWED_ORIGINS` — **or** if it carries the shared phrase. Anything else is
refused, including a request with no `Origin` header at all, so a deployment with no phrase
set is still not usable by a stranger with the URL.

An `Origin` header proves nothing on its own; it is trivially forged by anything that is not
a browser. **Set `SHARED_PASS`** if the URL might be discovered. That is the real gate.

## Opening it the first time

A Worker has no public URL until you turn one on. If the Overview says **No URLs enabled**,
go to **Settings → Domains & Routes → Enable `workers.dev`**. The site is then at
`https://kartz.<your-subdomain>.workers.dev` — open it in any browser, there is nothing to
start and nothing to install.

Every push to `main` redeploys it automatically.

On a phone, open that URL and use **Share → Add to Home Screen**. It then behaves like an
app, which is worth doing because the phone is where the recording already lives.

### Setting it up, once per device

1. Paste the link to your **Alliance Rosters** tab and press **Pull roster**. It should say
   something like *roster: 689 names (139 skipped)*. If it complains about a sign-in page,
   the sheet is not link-readable: *Share → General access → Anyone with the link → Viewer*.
2. Choose the model:
   - **Cloudflare Workers AI** — nothing else to fill in. The endpoint is already `/api`,
     which is this same site, and the AI binding does the rest.
   - **Shared key (server-side)** — same, but runs your Gemini key from the server. Needs
     `GEMINI_KEY` set in the project settings.
   - **Google Gemini** — paste your own key instead. No server involved.
3. If you set a `SHARED_PASS`, type it in the **Shared phrase** box.
4. Press **Save setup**. It is remembered in that browser.

The badge next to *Setup* turns green and shows the roster count when it is ready.

### Checking the server side is alive

If a run fails with a 403 or 502, the quickest check is whether the API half of the site is
answering at all. In a terminal:

```bash
curl -i -X POST https://kartz.<your-subdomain>.workers.dev/api/@cf/meta/llama-4-scout-17b-16e-instruct -H 'content-type: application/json' -d '{"contents":[{"parts":[{"text":"hi"}]}]}'
```

- **403** — expected from curl when no phrase is set: it means the Function is deployed and
  refusing a non-browser caller, which is correct. Add `-H 'x-kartz-pass: <your phrase>'`
  to get past it.
- **502 with "no AI binding"** — the Workers AI binding is missing. Add it in project
  settings and redeploy.
- **404, or the HTML of the page** — the request never reached `worker.js`. Check that
  `wrangler.toml` still has `main = "worker.js"` alongside the `[assets]` block.

## Sharing it with your officers

Send them the `.workers.dev` URL and, if you set one, the shared phrase. That is all — they
pull the roster themselves and never touch an API key, because the key lives in Cloudflare
and the browser never sees it.

**A static page cannot keep a secret.** Anything `index.html` sends, a viewer can read out
of the browser's network tab. That is the whole reason the model call happens server-side in
`worker.js` rather than in the page: keys stay in the project's settings, not in the
repository and not in anyone's browser. Never commit a key.

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
- **confirm** — not in the roster. Pick the right player from the dropdown, leave it as a new
  player, or discard it if it is not a real row.
- **A coverage warning** means the game showed a rank higher than the number of rows that
  came through, so players were missed. Raise *Frames to send*.
- **A "seen in a single frame" warning** is a different complaint and the more common cause
  of wrong names. The list can be complete and still be full of misreadings.

Ties are common — several players often share a score — so the row order within a tie is
arbitrary. The sheet looks players up by name, so this does not matter.

## The roster goes into the prompt

The single biggest thing that improved accuracy was not a better model — it was asking a
different question. Reading a name off a screen is open-ended, and stylised game tags defeat
it. Deciding *which of 689 known players* a row belongs to is a much easier question, and
the roster is already loaded.

So the roster is sent with the request, and the model returns the entry it recognises rather
than a transcription. It costs about 1,300 tokens, and it moved usable names from roughly
three-quarters to almost all of them on a 153-player recording.

The model's answer is not taken on trust: a name it returns must genuinely exist in the
roster, or the row falls back to fuzzy matching and is raised for confirmation.

## Two ways to read a recording

**Sampling frames** (the default) picks stills and sends them in batches. Names benefit from
being read several times and voted on, but coverage depends on the frame budget matching how
fast the list was scrolled.

**Send the whole video** hands Gemini the clip and lets it do its own sampling — the same
thing the Google AI Studio app does. One request covers the entire list, so nothing can fall
between frames, but each player is read exactly once and there is no second reading to
outvote a bad one.

Measured on the same 43-second, 153-player recording:

Measured on the same 43-second, 153-player recording:

| | frames | whole video, roster in prompt |
|---|---|---|
| rows returned | 147 of 153 | **153 of 153**, ranks 1..153 |
| requests | 5 to 29 | **1** |
| time | 63s | **26s** |
| rank 1 read as | `Noxira` / `Nitro` ✗ | **`Neaira`** ✓ |
| rows needing a decision | 13 | **8** |
| coverage warning | yes | none |

Whole-video is the better setting for this. It cannot miss a player, because nothing depends
on the frame budget lining up with how fast the list was scrolled, and with the roster in the
prompt the names hold up too. Under about 14 MB, and Gemini only.

Of the eight rows left to decide, six are **contested**: two rows both resolving to one
roster entry, usually a main and an alt sharing a display name where the roster lists only
one of them. Neither the model nor a fuzzy match can settle that, so both rows are shown and
neither is emitted until you choose. The other two were genuinely absent from the roster.

Frames mode remains useful when a recording is too large for whole-video, and it is the only
mode that reads a name several times and votes.

## Getting the names right

A name is decided by majority vote across the frames a player appears in. If most players
appear in exactly one frame there is no vote to take, and a single bad reading stands.

Sightings per player works out as **frames sent divided by the number of screenfuls the list
occupies** — about seven rows fit on screen, so a 153-player list is roughly 22 screenfuls:

| frames | sightings each | effect |
|---|---|---|
| 40 | 1.8 | finds nearly everyone, but names cannot be cross-checked |
| 60 | 2.7 | better |
| 72 | 3.3 | a wrong reading gets outvoted |

Note what this does *not* depend on: how long the recording is. Scrolling more slowly does
not help by itself, because the frame budget is spread across the same number of screenfuls
either way. Send more frames instead. The page suggests a number once it knows how long the
list is.

Coverage and name accuracy therefore want different settings. 40 frames found 148 of 153
players on a test recording but left most of them seen once; the same recording at 72 gives
three sightings each and lets voting do its job.

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

### Cloudflare Workers AI — measured, and not recommended for this

Reachable only through the Worker: the REST API answers a CORS preflight with 405 and sends
no allow-origin header, so a page cannot call it however the request is shaped. Through the
Worker it does work, and Llama 4 Scout does accept images.

It reads the *numbers* perfectly — every rank and score matched what Gemini produced. Names
are the problem, and on a 153-player list they are the problem badly:

| | players found | matched to roster |
|---|---|---|
| Gemini | 147 | 134 (**91%**) |
| Llama 4 Scout | 158 | 129 (82%) |

Finding 158 players in a list of 153 is itself the symptom: a name read differently in two
frames becomes two rows. Mid-list it is respectable — 89 to 96% on a sample of eight frames —
but the stylised names at the top defeat it, and those are the ranks people look at.

One setting matters a great deal if you use it. Measured on the same eight frames:

| frames per call | rows read per frame |
|---|---|
| 8 | 3.5 |
| 4 | 4.1 |
| **2** | **5.8** |
| 1 | 6.0 |

Given eight images at once the model stops reading partway through, and the rows it skips are
exactly what the majority vote needs. Two per call is now the default for this provider, and
it lifted a full run from 203 sightings to 310, with players-seen-only-once falling from 139
to 38. It did not rescue the match rate, because more readings of a name do not help when the
readings disagree with each other rather than converging.

There is no fallback model configured: `llama-3.2-11b-vision-instruct` refuses every request
until Meta's terms are accepted by hand in the Cloudflare dashboard.

Use it if you want everything on one Cloudflare account with no keys anywhere, and you are
willing to confirm more names by hand. For accuracy, use Gemini.

| provider | free vision | notes |
|---|---|---|
| **Gemini** | 20/day per model, 7 models | default; measured 40/40 on a real recording |
| **Groq — Qwen** | 1000/day but 8k tokens/min | accurate and fast per call, slow in bulk |
| **OpenRouter** | ~50 requests/day | 8 free vision models |
| **Mistral** | free tier | Pixtral |
| **Cloudflare** | 10k neurons/day | via the Worker only; untested against a real account |
| **Anthropic** | paid | no free tier |

