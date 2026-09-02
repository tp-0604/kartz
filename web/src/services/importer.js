// Reading the tracking workbook.
//
// Three years of tabs, and the shape drifted five times. Rather than one parser per era, the
// header row is read and the columns are recognised by what they are called:
//
//   day columns   Day 1 / Day 4 / Final on a month tab. One board per column per alliance.
//   flat rows     date | rank | name | points — what the extractor itself produces, and what
//                 the north and central tabs hold. Real dates and the game's own ranks.
//
// A scoring event runs seven days: Day 1, then Day N is N-1 days after it, and the Final is
// Day 7. That is not a guess — the north tab labels its three columns Day 1, Day 4 and Day 7,
// and the dated rows in north and central show 23/26/29 March, 27/30 April with 3 May, and
// 25/28/31 May. Every one of them is three days apart, and every Day 1 is the fourth Monday
// of its month.
import { parseCsv } from '../extractor/roster.js';
import { fold } from '../extractor/matching.js';

export const FINAL_OFFSET = 6;                 // the Final is Day 7

// The alliances are written four ways across the years — 698N, North, north — and they are
// one thing. Anything unrecognised is passed through: 698E and z1.Transferred are real values.
const ALLIANCE_ALIASES = { north: '698N', south: '698S', west: '698W', central: '698C' };
export function normAlliance(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return ALLIANCE_ALIASES[s.toLowerCase()] || s;
}

export function parseTable(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  if ((first.match(/\t/g) || []).length >= 1)
    return text.split(/\r?\n/).map(l => l.split('\t')).filter(r => r.some(c => String(c).trim()));
  return parseCsv(text);
}

// Headers arrive with underscores from the extractor's own tabs and with stray spacing from
// everywhere else.
const norm = s => String(s ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// A column that measures something about two days, or reports a tick, is not a score.
const NOT_A_SCORE = /growth|status|check|total|overall|to final|day\s*\d+\s*[-–]\s*\d|day\s*\d+\s*[-–]\s*final/;

const MONTH_NAMES = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/;
const DAY_RE = /^day\s*(\d+)(\s*score)?$/;
const FINAL_RE = /^final(\s*score)?$/;

/**
 * Work out what the columns of a table mean.
 * @param {any[][]} rows
 * @returns {null | { kind, headerRow, search, ingame, alliance, date, rank, points, label, days }}
 */
/**
 * Where the separate tables on one tab begin and end.
 *
 * The working tabs carry three or four tables side by side with empty columns between them —
 * the extractor's dated rows, then a pivot of them, then a month somebody assembled by hand —
 * and one of those blocks is the only copy of an alliance's month. A run of columns that has
 * something in its first few rows is a table; a gap ends it.
 */
export function detectBlocks(rows) {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const head = rows.slice(0, 3);
  const used = [];
  for (let c = 0; c < width; c++)
    used[c] = head.some(r => r && r[c] !== undefined && String(r[c] ?? '').trim() !== '');
  const blocks = [];
  let from = -1;
  for (let c = 0; c <= width; c++) {
    if (c < width && used[c]) { if (from < 0) from = c; continue; }
    if (from >= 0) { blocks.push({ from, to: c }); from = -1; }
  }
  return blocks
    .filter(b => b.to - b.from >= 2)
    .map(b => ({ ...b, rows: rows.map(r => r.slice(b.from, b.to)) }));
}

export function detectLayout(rows) {
  if (!rows || !rows.length) return null;
  // The header is not always the first row: one tab carries a title above it.
  let headerRow = -1, hdr = null;
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const h = (rows[r] || []).map(norm);
    const named = h.some(x => /name$/.test(x) || x === 'date' || DAY_RE.test(x) || FINAL_RE.test(x));
    if (named && h.filter(Boolean).length >= 3) { headerRow = r; hdr = h; break; }
  }
  if (headerRow < 0) return null;

  const find = re => hdr.findIndex(h => re.test(h));
  let search = find(/^(searchable|search|member)\s*name$/);
  let ingame = find(/^(game name|in ?game name)$/);
  const playerName = find(/^player name$/);
  // "Player Name" on the older tabs is the name as the game drew it, not the searchable one.
  if (ingame < 0 && playerName >= 0) ingame = playerName;

  const days = [];
  hdr.forEach((h, i) => {
    if (!h || NOT_A_SCORE.test(h)) return;
    const m = h.match(DAY_RE);
    if (m) { const off = +m[1] - 1; days.push({ col: i, label: off === FINAL_OFFSET ? 'Final' : 'Day ' + m[1], offset: off }); }
    else if (FINAL_RE.test(h)) days.push({ col: i, label: 'Final', offset: FINAL_OFFSET });
  });
  // One tab lost the name of its Day 1 column in a copy and shows Google's "Column 6"
  // placeholder. The status column beside it kept its name, and a "Day N Status" is always
  // immediately right of the score it reports on, so the score can be recovered from it.
  hdr.forEach((h, i) => {
    const m = h && h.match(/^day\s*(\d+)\s*status$/);
    if (!m || i === 0) return;
    const label = 'Day ' + m[1];
    if (days.some(d => d.label === label)) return;
    const left = hdr[i - 1];
    if (left && !/^column \d+$/.test(left)) return;      // only claim a column with no name
    days.push({ col: i - 1, label, offset: +m[1] - 1 });
  });
  days.sort((a, b) => a.col - b.col);

  // A table headed with its own month — "March" above the names — keeps the searchable name
  // in that column and the drawn name beside it.
  if (search < 0 && ingame === 1 && MONTH_NAMES.test(hdr[0] || '')) search = 0;

  const layout = {
    headerRow,
    search, ingame,
    alliance: find(/^(current )?alliance$/),
    date: find(/^(date|kartz date)$/),
    rank: find(/^(rank|place)$/),
    points: find(/^(kartz points|points|score)$/),
    label: find(/^(day|label|scoring day)$/),
    days,
  };
  if (layout.date >= 0 && layout.points >= 0 && (ingame >= 0 || search >= 0)) layout.kind = 'flat';
  else if (days.length && (ingame >= 0 || search >= 0)) layout.kind = 'days';
  else return null;
  return layout;
}

// Excel and Sheets both hand dates over as serial numbers.
export const toYmd = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 90000)
    return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? null : d.toLocaleDateString('en-CA');
};

const toNum = v => {
  if (typeof v === 'number') return Math.round(v);
  const m = String(v ?? '').replace(/[,\s]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Math.round(+m[0]) : null;
};

export const addDays = (ymd, n) => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The names in a tab are whatever somebody typed; the roster says who they are.
function matcher(roster) {
  const bySearch = new Map(), byIngame = new Map();
  for (const r of roster || []) {
    const a = fold(r.search), b = fold(r.ingame);
    if (a && !bySearch.has(a)) bySearch.set(a, r);
    if (b && !byIngame.has(b)) byIngame.set(b, r);
  }
  return name => {
    const k = fold(name);
    return k ? (bySearch.get(k) || byIngame.get(k) || null) : null;
  };
}

// A row that is a note, a total or a blank is not a player.
const JUNK = /^(total|totals|sum|average|grand total|n:|s:|w:|c:)\b/i;

/**
 * Turn a table into boards.
 * @param {any[][]} rows
 * @param {object} layout        from detectLayout
 * @param {object} o
 * @param {string} o.day1        the date of Day 1, for a table with day columns
 * @param {string} o.alliance    the alliance, when the table does not name one
 * @param {Array}  o.roster      to resolve names
 * @param {string} o.source      which tab this came from, for the plan
 * @returns {Array} boards: { date, alliance, label, rows, unmatched, duplicates, source, precise }
 */
export function buildBoards(rows, layout, { day1, alliance = '', roster, source = '' } = {}) {
  const body = rows.slice(layout.headerRow + 1);
  const match = matcher(roster);
  const groups = new Map();
  const put = (key, meta, row) => {
    if (!groups.has(key)) groups.set(key, { ...meta, rows: [] });
    groups.get(key).rows.push(row);
  };

  const nameOf = r => {
    const s = layout.search >= 0 ? String(r[layout.search] ?? '').trim() : '';
    const g = layout.ingame >= 0 ? String(r[layout.ingame] ?? '').trim() : '';
    const hit = match(s) || match(g);
    return {
      search: hit ? hit.search : (s || null),
      ingame: g || (hit ? hit.ingame : '') || s,
      rosterAlliance: hit ? hit.alliance : null,
      matched: !!hit,
    };
  };

  if (layout.kind === 'flat') {
    for (const r of body) {
      const date = toYmd(r[layout.date]);
      if (!date) continue;
      const nm = nameOf(r);
      if (!nm.ingame || JUNK.test(nm.ingame)) continue;
      const points = toNum(r[layout.points]);
      if (points === null) continue;
      const board = normAlliance(layout.alliance >= 0 ? r[layout.alliance] : '') || alliance || nm.rosterAlliance || '';
      if (!board) continue;
      const label = layout.label >= 0 ? String(r[layout.label] ?? '').trim() || null : null;
      put(`${date}|${board}|${label || ''}`, { date, alliance: board, label, source, precise: true },
          { place: layout.rank >= 0 ? toNum(r[layout.rank]) : null, search: nm.search,
            ingame: nm.ingame, alliance: nm.rosterAlliance, points, matched: nm.matched });
    }
  } else {
    if (!day1) return [];
    for (const r of body) {
      const nm = nameOf(r);
      if (!nm.ingame || JUNK.test(nm.ingame)) continue;
      const rowAlliance = normAlliance(layout.alliance >= 0 ? r[layout.alliance] : '');
      const board = rowAlliance || alliance || nm.rosterAlliance || '';
      if (!board) continue;
      for (const d of layout.days) {
        const points = toNum(r[d.col]);
        if (points === null) continue;          // no recording of that day for this player
        const date = addDays(day1, d.offset);
        put(`${date}|${board}|${d.label}`, { date, alliance: board, label: d.label, source, precise: false },
            { place: null, search: nm.search, ingame: nm.ingame,
              alliance: nm.rosterAlliance || rowAlliance || null, points, matched: nm.matched });
      }
    }
  }

  const out = [];
  for (const g of groups.values()) {
    // Where the tab kept the game's own rank, that is the rank. Where it did not, the rank is
    // the position by points, which is what the board showed.
    const hasRanks = g.rows.length > 0 && g.rows.every(r => r.place > 0);
    let ranked = hasRanks
      ? g.rows.slice().sort((a, b) => a.place - b.place)
      : g.rows.slice().sort((a, b) => b.points - a.points).map((r, i) => ({ ...r, place: i + 1 }));
    // A rank can only be claimed once; a repeat is a row the sheet recorded twice.
    const seen = new Set();
    ranked = ranked.filter(r => { if (seen.has(r.place)) return false; seen.add(r.place); return true; });
    // Two rows under one roster name would double-count that player, so the name is recorded
    // but the identity is not claimed — the same answer the extractor gives for the case.
    const byName = new Map();
    for (const r of ranked) if (r.search) byName.set(r.search, (byName.get(r.search) || 0) + 1);
    let duplicates = 0;
    for (const r of ranked) {
      if (r.search && byName.get(r.search) > 1) { r.search = null; r.matched = false; duplicates++; }
    }
    out.push({ ...g, rows: ranked, unmatched: ranked.filter(r => !r.matched).length, duplicates });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.alliance.localeCompare(b.alliance));
}

export const boardId = b => `kartz|${b.date}|${b.alliance}`;

// z1.Transferred and z3.? are the sheet's parking bays, not alliances anyone played for.
export const isParked = a => /^z\d*\./i.test(String(a || ''));
