// From sightings to rows: dropping other screens, grouping by rank, voting on the name.
// Lifted verbatim from the single-file page, with log routed through ctx.
import { ctx } from './context.js';
import { sim, fold } from './matching.js';

// resolution made those legible enough to be read too. Everything in one Kartz list sits in
// the same range, so a reading far outside the bulk did not come from this list.
function dropForeignRows(sightings) {
  const pts = sightings.map(s => s && s.points).filter(n => typeof n === 'number' && n > 0)
                       .sort((a, b) => a - b);
  if (pts.length < 8) return sightings;
  const median = pts[pts.length >> 1];
  const ceiling = median * 8;
  // Zero is a real score. The foot of a Kartz board is players who scored nothing all month,
  // and treating zero as proof of a bogus row quietly deleted five of them in a row — ranks
  // 128 MndFlayr through 132 MEOW² — from a recording that showed them perfectly clearly.
  //
  // What a zero cannot supply is the corroboration a positive score gives, so that has to
  // come from somewhere else: the rank. A row carrying a rank number is a row from the list.
  // The case this filter was built for had none — "Not Playing", from the phone's music
  // widget, leaked in at the start of a recording and arrived with no rank at all.
  const kept = sightings.filter(s => {
    if (!s || typeof s.points !== 'number') return false;
    if (s.points > ceiling) return false;              // a score off some other screen
    if (s.points > 0) return true;
    return typeof s.rank === 'number' && s.rank > 0;   // zero, but it knows its place in the list
  });
  const lost = sightings.length - kept.length;
  if (lost) ctx.log(`ignored ${lost} row(s) that were not part of the list`);
  return kept;
}

// A second look at the rows that did not match.
//
// Reading a name outright is the hard version of the question. Choosing between twenty
// candidates while looking at the picture is the easy one, and the API can be made to answer
// only from a list, so the model cannot invent a name. Tested on the row that had defeated
// every other approach: "ŊŲƁĮ" reads as Dubi at any magnification — 0.75 similar to Nubi and
// so just under the matching threshold — but offered the shortlist it picks ŊŲƁĮ correctly.
//
// Only unmatched rows go through this, so it is one extra request rather than a second pass
// over everything.
function consolidate(sightings, frameCount) {
  const byRank = new Map();
  const orphans = [];
  for (const s of sightings) {
    if (!s || typeof s.points !== 'number') continue;
    if (typeof s.rank === 'number' && s.rank > 0) {
      if (!byRank.has(s.rank)) byRank.set(s.rank, []);
      byRank.get(s.rank).push(s);
    } else orphans.push(s);          // rank unreadable — fall back to matching on name
  }
  // a row whose rank never came through still belongs somewhere; attach it to the rank
  // whose score and name it agrees with, and otherwise let it stand on its own
  for (const o of orphans) {
    let target = null;
    for (const [rank, g] of byRank) {
      if (mode(g.map(x => x.points)) !== o.points) continue;
      if (sim(fold(o.plain || o.name), fold(g[0].plain || g[0].name)) >= 0.6) { target = rank; break; }
    }
    if (target) byRank.get(target).push(o);
    else { const k = -(byRank.size + 1); byRank.set(k, [o]); }
  }
  const out = [];
  for (const [rank, g] of byRank) {
    const names = g.map(x => x.roster_name).filter(Boolean);
    out.push({
      points: mode(g.map(x => x.points)),
      name:   mode(g.map(x => x.name)),
      plain:  mode(g.map(x => x.plain || x.name)),
      // Every distinct reading of this rank, not only the commonest. A name misread three
      // ways is three chances to recognise the player: taking the mode and discarding the
      // rest threw away the readings that would have matched. "M[Y/B]" is one noisy
      // observation of a row, not the row's name.
      obs:    [...new Set(g.map(x => x.name).filter(Boolean))],
      claims: [...new Set(names)],
      pick_:  names.length ? mode(names) : '',
      rank:   rank > 0 ? rank : null,
      seenRank: rank > 0 ? rank : 0,
      seen:   g.length,
    });
  }
  return out.sort((a, b) => b.points - a.points || (a.seenRank || 9999) - (b.seenRank || 9999));
}

const mode = arr => {
  const c = new Map(); let best = null, n = 0;
  for (const v of arr) { const k = c.get(v) || 0; c.set(v, k + 1); if (k + 1 > n) { n = k + 1; best = v; } }
  return best;
};

export { dropForeignRows, consolidate, mode };
