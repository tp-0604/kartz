// The body of a run: video in, reviewed rows out. This is the old extractAndResolve with its
// globals turned into parameters and its DOM writes turned into callbacks. The matching logic
// inside is unchanged, step for step, because every step is there for a reason recorded in
// README.md.
import { ctx } from './context.js';
import { buildIndex, fold, aliasKey, resolve, claimPlausible } from './matching.js';
import { extractFrames, STRIPS } from './frames.js';
import { buildPrompt } from './prompt.js';
import { callModel, TPM_TARGET, CHARS_PER_TOKEN, IMG_TOKENS } from './model.js';
import { dropForeignRows, consolidate } from './consolidate.js';
import { MAIN_ALLIANCES, REQ_CAP, FRAME_BUDGET } from './config.js';

/**
 * @param {object} o
 * @param {File}   o.file          the screen recording
 * @param {Array}  o.roster        [{ search, ingame, alliance }] — the sheet with edits applied
 * @param {object} o.aliases       what Remember my fixes stored: aliasKey → { name, alliance }
 * @param {number} o.frameBudget   how many frames to aim for; trimmed to the token allowance
 * @param {boolean} o.sheetImage   send the reference sheet of symbol names as the first image
 * @param {function} o.onLog       one line of status at a time
 * @param {function} o.onProgress  0..1
 * @param {function} o.onFrames    a few sampled frames, base64 JPEG, for the strip
 * @returns {{ rows: Array, readings: number, frames: number, suggestedAlliance: string }}
 */
export async function runExtraction({
  file, roster, aliases = {}, frameBudget = FRAME_BUDGET, sheetImage = true,
  onLog = () => {}, onProgress = () => {}, onFrames = () => {},
}) {
  if (!file) throw new Error('Choose a recording first.');
  if (!roster || !roster.length)
    throw new Error('No roster loaded — press Pull roster on the Roster screen first.');
  ctx.log = onLog; ctx.progress = onProgress; ctx.frames = onFrames;
  try {
    const index = buildIndex(roster);
    const skipIndex = [];              // nothing is filtered out any more; see roster.js

    ctx.log('decoding video…'); ctx.progress(0);
    // How many sample points the minute's allowance actually affords, rather than a fixed
    // number that was right when it was written. The roster is sent with every request and it
    // grows; each name inflates the prompt on all six requests. So the images are whatever is
    // left after the prompts are paid for, and the frame count follows from that.
    const promptTok = Math.ceil(buildPrompt(roster, false).length / CHARS_PER_TOKEN);
    const perReq = promptTok + IMG_TOKENS;              // prompt, plus the reference sheet
    const imgBudget = Math.floor((TPM_TARGET - REQ_CAP * perReq) / IMG_TOKENS);
    const want = Math.max(24, Math.min(+frameBudget, Math.floor(imgBudget / STRIPS)));
    const frames = await extractFrames(file, want,
      (p, n) => { ctx.progress(p * 0.5); ctx.log(`sampling video — ${n} frames kept`); });
    if (!frames.length) throw new Error('no frames captured');
    ctx.frames(frames.slice(0, 24));
    ctx.log(`${frames.length} frames (${(frames.join('').length * 0.75 / 1024 | 0)} KB) — sending…`);
    let sightings = await callModel(frames, roster, sheetImage);
    const frameCount = frames.length;

    // Folded name -> roster entries. A Set, because a handful of keys are claimed by two
    // players — "Killua" and "Killua swords" both reduce to killua — and those cases must
    // not be decided by string folding.
    const byFold = new Map();
    for (const e of index) {
      if (!byFold.has(e.k)) byFold.set(e.k, new Set());
      byFold.get(e.k).add(e.r);
    }
    const soleMatch = k => { const set = k && byFold.get(k); return set && set.size === 1 ? [...set][0] : null; };

    sightings = dropForeignRows(sightings);
    const base = consolidate(sightings, frameCount);
    const rows = base.map(r => {
      // Order matters, most authoritative first.
      // 1. Something you corrected by hand and saved. Nothing should overrule that.
      const al = aliases[aliasKey(r.plain || r.name)] || aliases[aliasKey(r.name)];
      if (al) {
        const nm = typeof al === 'string' ? al : al.name;
        const hit = soleMatch(fold(nm)) || byFold.get(fold(nm))?.values().next().value;
        if (hit) return { ...r, match: hit, score: 1, pick: hit.search };
      }
      // 2. The name as actually drawn, when exactly one roster entry reduces to it. Every
      //    distinct reading of the row is tried, not just the commonest.
      const readings = (r.obs && r.obs.length) ? r.obs : [r.name];
      for (const o of readings) {
        const bySeen = soleMatch(fold(o));
        if (bySeen) return { ...r, match: bySeen, score: 1,
                             pick: bySeen.ingame || bySeen.search, via: 'drawn:' + o };
      }
      // 3. The roster entry the model named — provided it really exists AND some reading of
      //    the row actually supports it.
      for (const c of (r.claims && r.claims.length ? r.claims : [r.pick_]).filter(Boolean)) {
        const entry = soleMatch(fold(c)) || byFold.get(fold(c))?.values().next().value;
        if (!entry) continue;
        if (!readings.some(o => claimPlausible(o, entry))) continue;
        return { ...r, match: entry, score: 1,
                 pick: entry.ingame || entry.search, claimed: true, via: 'claim:' + c };
      }
      // 4. Fuzzy over every reading, and failing that the row is raised for confirmation.
      let m = { r: null, score: 0, near: null }, from = '';
      for (const o of readings) {
        const t = resolve(o, o, index, aliases);
        if (t.score > m.score) { m = t; from = o; }
      }
      if (m.r) return { ...r, match: m.r, score: m.score, near1: m.near1,
                        pick: m.r.ingame || m.r.search, via: 'near:' + from };
      const sk = skipIndex.length ? resolve(r.name, r.plain, skipIndex, {}) : { r: null };
      if (sk.r) return { ...r, match: null, skipped: sk.r, score: sk.score, pick: '' };
      return { ...r, match: null, score: m.score, near: m.near, pick: '', via: 'none' };
    });
    // Two rows resolving to one player means at least one of them is wrong. Neither keeps the
    // match; both carry their own names on, flagged for confirmation like anything else.
    const claims = new Map();
    for (const r of rows) {
      if (!r.match || r.skipped) continue;
      const k = fold(r.match.search);
      if (!claims.has(k)) claims.set(k, []);
      claims.get(k).push(r);
    }
    for (const [, group] of claims) {
      if (group.length < 2) continue;
      for (const r of group) { r.match = null; r.pick = ''; r.score = 0; }
    }
    // The rank the game printed is the rank. A gap in the numbering is honest and the screen
    // points straight at it; a silent off-by-three is not.
    let n = 0;
    for (const r of rows) {
      if (r.skipped) { r.rank = null; continue; }
      r.rank = r.seenRank > 0 ? r.seenRank : ++n;
      if (r.rank > n) n = r.rank;
    }
    // Offer the alliance most of the board belongs to. It is a proposal, not a decision.
    const tally = {};
    for (const r of rows) if (r.match && r.match.alliance)
      tally[r.match.alliance] = (tally[r.match.alliance] || 0) + 1;
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    const suggestedAlliance = top && MAIN_ALLIANCES.includes(top[0]) ? top[0] : '';

    ctx.log(`done — ${sightings.length} readings → ${rows.length} players`);
    ctx.progress(1);
    return { rows, readings: sightings.length, frames: frameCount, suggestedAlliance };
  } finally {
    ctx.log = () => {}; ctx.progress = () => {}; ctx.frames = () => {};
  }
}

// The ranks the game showed that never made it into the rows: a band of the list the sampling
// skipped over. Saying which band turns "something is short" into something you can check.
export function missingRanks(rows) {
  const seen = rows.map(r => r.seenRank).filter(n => typeof n === 'number' && n > 0);
  const top = Math.max(0, ...seen);
  const have = new Set(seen);
  const holes = [];
  for (let i = 1; i <= top; i++) if (!have.has(i)) holes.push(i);
  return { top, holes };
}
