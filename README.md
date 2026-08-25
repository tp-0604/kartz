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

## First-time setup (once per device)

1. Get an API key — [Google AI Studio](https://aistudio.google.com/apikey) is free and is the
   default. Anthropic also works if you prefer it.
2. Paste the key into the page.
3. Paste the roster: select columns A, B and C of the **InputRoster** tab and copy. Tab or
   comma separated, header row optional.
4. Press **Save setup**.

The key lives in that browser's local storage and is sent only to the model vendor.
**Do not put a key in the repository** — the page is public, but each person using it
brings their own key, which is the point.

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

## Cost

At the default 24 frames, about US$0.002 per recording on Gemini Flash, and comfortably
inside the free tier for normal use.
