// The prompt and the reference sheet. Lifted from the single-file page; the only change is
// that buildPrompt is handed the roster instead of reading it from a global.
import { usableFold, EXOTIC, exoticness } from './matching.js';

function rosterSheet(roster) {
  const items = roster
    .filter(r => (r.ingame || '').trim() && exoticness(r.ingame) >= EXOTIC)
    .map(r => ({ glyph: r.ingame.trim(), label: r.search }));
  if (!items.length) return null;

  const COLS = 4, ROW_H = 54, PAD = 14, COL_W = 260;
  const rowsN = Math.ceil(items.length / COLS);
  const cv = Object.assign(document.createElement('canvas'), {
    width: COLS * COL_W + PAD * 2, height: rowsN * ROW_H + PAD * 2 + 34 });
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
  cx.fillStyle = '#000'; cx.font = 'bold 20px sans-serif'; cx.textBaseline = 'top';
  cx.fillText('ROSTER REFERENCE — not a leaderboard', PAD, PAD);

  items.forEach((it, i) => {
    const c = i % COLS, rw = Math.floor(i / COLS);
    const x = PAD + c * COL_W, y = PAD + 34 + rw * ROW_H;
    cx.fillStyle = '#111';
    cx.font = '29px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    cx.fillText(it.glyph, x, y);
    cx.fillStyle = '#555'; cx.font = '13px sans-serif';
    cx.fillText(it.label, x, y + 34);
  });
  return cv.toDataURL('image/jpeg', 0.9).split(',')[1];
}

/* ---------------- vision model ---------------- */
// The model is not being asked to transcribe an unknown name — it is being asked which of
// a few hundred known players a row belongs to. Handing it the roster turns a reading
// problem into a recognition one, and that single change took usable names from about 76%
// to 99% on a 153-player recording. The list costs roughly 1,300 tokens.
export function buildPrompt(roster, forVideo, sheetOn = true) {
  // Give both forms. Column B holds the name as it is actually drawn in the game — the
  // stylised one the model is looking at — and for about a fifth of the roster it differs
  // from the name the sheet uses. Some of those pairs no string comparison could ever
  // bridge: "ERank" is Aalonsoj ALT, "TRD" is AcE, and one player renders as glyphs that
  // normalise to an empty string. Listing the mapping is the only thing that resolves them.
  const names = roster.map(r => {
    const a = (r.search || '').trim(), b = (r.ingame || '').trim();
    if (!a) return '';
    // Compare the literal strings, not the folded ones. Folding is deliberately aggressive
    // — it is what lets "ŊŲƁĮ" reduce to "nubi" — but that is exactly the pair the model
    // most needs to be shown. Judging sameness after folding hid every case the mapping
    // exists to solve.
    return (b && b !== a) ? `${a} = ${b}` : a;
  }).filter(Boolean);
  const src = forVideo
    ? 'This is a screen recording of a mobile game leaderboard called "Ranking".'
    : 'These are frames from a screen recording of a mobile game leaderboard called "Ranking".';
  const scope = forVideo ? 'in the whole video' : 'across ALL the images';
  const once = forVideo
    ? '- Report every player exactly once, in rank order. Do not skip rows and do not stop early.'
    : '- The same player appears in several frames. List every sighting; do not deduplicate.';
  // Emoji render differently on every platform, and the model is looking at one phone's
  // idea of a polar bear. Listing the symbol-only names as their own short set means it is
  // choosing between a handful of known characters rather than naming an emoji from scratch.
  // The codepoints go in alongside the character. A model knows that U+1F43B is a bear face
  // and U+2744 a snowflake, so it can work out that the two together are a polar bear — and
  // then decide whether the small black-and-white animal on screen is that or a panda.
  // Emoji are drawn differently on every phone; the codepoint is the thing that is not.
  const cps = str => [...str].map(c => c.codePointAt(0))
      .filter(c => c > 0x2000 && c !== 0x200D && c !== 0xFE0F && c !== 0xFE0E)
      .map(c => 'U+' + c.toString(16).toUpperCase()).join(' ');
  const symbolic = roster
    .filter(r => (r.ingame || '').trim() && !usableFold(r.ingame))
    .map(r => { const g = r.ingame.trim(), c = cps(g);
                return `${r.search} = ${g}${c ? ` [${c}]` : ''}`; });
  const symbolNote = symbolic.length ? `

Some players' names are only symbols, emoji or non-Latin characters. These are all of them:
${symbolic.join(', ')}
When a row's name has no letters, it is almost certainly one of those. The bracketed
codepoints tell you what each one actually is — work out what that character depicts, then
decide which of them the picture on screen shows. Emoji are drawn differently on every
phone, so judge by what is depicted, never by an exact shape. Two animals being similar
colours does not make them the same animal.` : '';
  const sheetNote = sheetOn ? `

The FIRST image is not a leaderboard. It is a reference sheet showing how the unusually
written names are drawn, each with that player's roster name printed underneath. Whenever a
leaderboard row's name is in an odd script, decorated lettering or emoji, compare the shapes
against that sheet and answer with the roster name printed beneath the one it matches —
that is far more reliable than reading such a name character by character. Never report a row
from the reference sheet itself.` : '';
  return `${src}
Each row has a rank number (a gold, silver or bronze medal for ranks 1, 2 and 3), a player
name, and a line reading "Contribution (Pt): <number>".

The players are drawn from the known roster below. Nearly every row is one of these people.

IMPORTANT — for any name that is stylised, decorative, symbolic, or written in unusual
Unicode:
- Do NOT read it character by character. Do not guess at Unicode codepoints.
- Treat the name as a visual pattern. Compare its overall shape against the references you
  have been given and answer with the roster member it looks like.
- A shape that clearly matches a reference is stronger evidence than any letter-by-letter
  reading you could attempt. Prefer the match.
- Still fill in "seen" with your honest literal reading of what is drawn, however wrong it
  may look. A person checks the match against it, so it must stay an independent record —
  never copy the roster name into "seen".

Known players (${names.length}), written as "sheet name = name as drawn in the game".
The leaderboard shows the RIGHT-hand form. Match what is on screen against those, then answer
with the LEFT-hand sheet name. Where only one name is listed, the two forms are identical.
This list is reference material — never report a word from it as a row you saw.
${names.join(', ')}

${symbolNote}${sheetNote}

Return every row you can read ${scope} as a single JSON array, one object per row:
{"rank": <int or null>, "roster_name": "<a name copied exactly from the ROSTER, or null>", "seen": "<the name as actually drawn on screen>", "points": <int>}

Rules:
- "roster_name" MUST be copied character-for-character from the list above, or be null if
  you are genuinely confident this player is not on it. Never invent a spelling.
- Prefer a known player whenever the drawn name plausibly corresponds to one, allowing for
  stylised glyphs, emoji, accents and lookalike characters.
- "seen" is the raw on-screen name, so a person can check the match.
- Some players have no letters in their name at all — just emoji, symbols or non-Latin
  characters. Reproduce those exactly, character for character, in "seen"; do not substitute
  a similar-looking emoji. A polar bear is not a panda. The roster lists these names in the
  same form, so an exact copy will match one.
- For ranks 1 to 3 the number is a medal graphic; infer 1, 2 or 3 from its colour.
- Read ONLY rows inside the "Ranking" panel. A recording often opens on another screen, or
  passes over a different leaderboard on the way; ignore anything that is not the Ranking
  list, however clearly you can read it.
- Ignore the highlighted card pinned at the very bottom; it repeats the viewer's own row.
${once}
- If a row is cut off at an edge and cannot be read fully, skip it.
- Output raw JSON only. No markdown fence, no commentary.`;
}


export { rosterSheet };
