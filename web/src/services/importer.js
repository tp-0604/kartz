// Backloading history from the Kartz Tracking workbook.
//
// Three shapes have been used over the years, and the importer reads all of them:
//
//   month tab (2026)      Searchable Name | Game Name | CP | MM/CE | Alliance | Day 1 Score |
//                         … | Day 4 Score | … | Final Score | …        one tab, every alliance
//   alliance tab (2025)   Player Name | CP | Day 1 Score | Day 4 score | … | Final Score
//                         one tab per alliance, the alliance in the tab's name
//   flat rows             Date | Rank | Game Name | Kartz Points (| Alliance | Day)
//                         what this app copies out, and what a plain export looks like
//
// A month tab holds no dates, only day numbers, so the caller supplies the date of Day 1 and
// the rest follow: the recordings are three days apart, Day 4 is +3 and the Final is +6.
import { parseCsv } from '../extractor/roster.js';
import { fold } from '../extractor/matching.js';
import { addDays } from '../utils/format.js';

export function parseTable(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  if ((first.match(/\t/g) || []).length >= 1)
    return text.split(/\r?\n/).map(l => l.split('\t')).filter(r => r.some(c => c.trim()));
  return parseCsv(text);
}

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// Which columns mean what. Score columns are anything headed "Day N …" or "Final …"; a status
// or growth column beside them is skipped because it does not say "score".
export function detectLayout(rows) {
  if (!rows.length) return null;
  const header = rows[0].map(norm);
  const find = re => header.findIndex(h => re.test(h));
  const scoreCols = [];
  header.forEach((h, i) => {
    if (/growth|status|check|day\s*\d+\s*[-–]/.test(h)) return;
    let m = h.match(/^day\s*(\d+)(\s*score)?$/);
    if (m) { scoreCols.push({ i, label: `Day ${m[1]}`, offset: +m[1] - 1 }); return; }
    if (/^final(\s*score)?$/.test(h)) scoreCols.push({ i, label: 'Final', offset: 6 });
  });
  const cols = {
    search:   find(/^search(able)?\s*name/),
    ingame:   find(/^(game name|in\s*game name|name in video|player name|player)$/),
    alliance: find(/^alliance$/),
    date:     find(/^(date|kartz date)$/),
    rank:     find(/^(rank|place)$/),
    points:   find(/^(kartz points|points|score)$/),
    label:    find(/^(day|label|scoring day)$/),
    scores:   scoreCols,
  };
  let kind = null;
  if (cols.date >= 0 && cols.points >= 0 && (cols.ingame >= 0 || cols.search >= 0)) kind = 'flat';
  else if (scoreCols.length && cols.alliance >= 0) kind = 'month';
  else if (scoreCols.length && (cols.ingame >= 0 || cols.search >= 0)) kind = 'alliance';
  return { kind, header: rows[0], cols };
}

// Excel and Sheets both export dates as serials now and then.
const toYmd = v => {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const n = Number(s);
  if (Number.isFinite(n) && n > 30000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toLocaleDateString('en-CA');
};
const toNum = v => {
  const m = String(v ?? '').replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(+m[0]) : null;
};

// Names in a tab are whatever people typed; the roster says who they are.
function matcher(roster) {
  const bySearch = new Map(), byIngame = new Map();
  for (const r of roster || []) {
    const a = fold(r.search), b = fold(r.ingame);
    if (a && !bySearch.has(a)) bySearch.set(a, r);
    if (b && !byIngame.has(b)) byIngame.set(b, r);
  }
  return name => {
    const k = fold(name);
    if (!k) return null;
    return bySearch.get(k) || byIngame.get(k) || null;
  };
}

/**
 * @returns [{ date, alliance, label, rows: [{ place, search, ingame, alliance, points }], unmatched }]
 */
export function buildBoards(rows, layout, { day1, alliance, roster }) {
  const { cols, kind } = layout;
  const body = rows.slice(1);
  const match = matcher(roster);
  const groups = new Map();
  const put = (key, meta, row) => {
    if (!groups.has(key)) groups.set(key, { ...meta, rows: [] });
    groups.get(key).rows.push(row);
  };

  const nameOf = r => {
    const search = cols.search >= 0 ? String(r[cols.search] || '').trim() : '';
    const ingame = cols.ingame >= 0 ? String(r[cols.ingame] || '').trim() : '';
    const hit = match(search) || match(ingame);
    return {
      search: hit ? hit.search : (search || null),
      ingame: ingame || (hit ? hit.ingame : search) || search,
      rosterAlliance: hit ? hit.alliance : null,
      matched: !!hit,
    };
  };

  if (kind === 'flat') {
    for (const r of body) {
      const date = toYmd(r[cols.date]); if (!date) continue;
      const nm = nameOf(r); if (!nm.ingame) continue;
      const pts = toNum(r[cols.points]); if (pts === null) continue;
      const alli = cols.alliance >= 0 ? String(r[cols.alliance] || '').trim() : '';
      const board = alli || alliance || nm.rosterAlliance || '';
      const label = cols.label >= 0 ? String(r[cols.label] || '').trim() || null : null;
      put(`${date}|${board}|${label || ''}`, { date, alliance: board, label },
          { place: cols.rank >= 0 ? toNum(r[cols.rank]) : null, search: nm.search, ingame: nm.ingame,
            alliance: nm.rosterAlliance, points: pts, matched: nm.matched });
    }
  } else {
    for (const r of body) {
      const nm = nameOf(r); if (!nm.ingame) continue;
      const rowAlli = kind === 'month' ? String(r[cols.alliance] || '').trim() : '';
      const board = kind === 'month' ? rowAlli : alliance;
      if (!board) continue;
      for (const sc of cols.scores) {
        const pts = toNum(r[sc.i]);
        if (pts === null) continue;                   // no recording of that day for this player
        const date = addDays(day1, sc.offset);
        put(`${date}|${board}|${sc.label}`, { date, alliance: board, label: sc.label },
            { place: null, search: nm.search, ingame: nm.ingame,
              alliance: nm.rosterAlliance || rowAlli || null, points: pts, matched: nm.matched });
      }
    }
  }

  const out = [];
  for (const g of groups.values()) {
    // Rank is the order of points, highest first, when the tab did not record one.
    const ranked = g.rows.every(r => r.place > 0) ? g.rows.slice().sort((a, b) => a.place - b.place)
      : g.rows.slice().sort((a, b) => b.points - a.points).map((r, i) => ({ ...r, place: i + 1 }));
    const seen = new Set();
    const rows = ranked.filter(r => { if (seen.has(r.place)) return false; seen.add(r.place); return true; });
    out.push({ ...g, rows, unmatched: rows.filter(r => !r.matched).length });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.alliance.localeCompare(b.alliance));
}
