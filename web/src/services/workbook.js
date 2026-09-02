// Reading the whole tracking workbook and working out what it says.
//
// The tabs are named for the thing they hold — "June 2026", "North September 2025" — and that
// name carries the month and sometimes the alliance. What no month tab carries is a date: it
// records Day 1, Day 4 and Final, and which days those actually were is nowhere on it.
//
// Two tabs do know. north and central hold the extractor's own rows, with the date and the
// game's rank on every one, and between them they date March, April and May 2026: the 23rd,
// the 27th and the 25th, each a Monday, each the fourth Monday of its month, and each followed
// three and six days later by the other two boards. So a month with no dates of its own is
// offered its fourth Monday, which is right every time the workbook can be checked against —
// and it is offered, not assumed, because a month the workbook cannot vouch for is the user's
// to confirm.
import { detectLayout, detectBlocks, buildBoards, addDays, toYmd, normAlliance, boardId, isParked } from './importer.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
                'july', 'august', 'september', 'october', 'november', 'december'];

/** The fourth Monday of a month, as YYYY-MM-DD. */
export function fourthMonday(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const toMonday = (8 - first.getUTCDay()) % 7;
  return new Date(Date.UTC(y, m - 1, 1 + toMonday + 21)).toISOString().slice(0, 10);
}

export const monthLabel = ym =>
  new Date(ym + '-02T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

const SKIP = {
  inputroster: 'the roster — the app reads it live on the Roster screen',
  'data loading': 'the instructions for the old workflow, not scores',
  combine: 'a working copy of one month, with no alliance on its rows',
};

/** What a tab is, from its name alone. */
export function classify(name) {
  const clean = name.trim();
  const low = clean.toLowerCase();
  if (SKIP[low]) return { kind: 'skip', why: SKIP[low] };
  // "north", "central" — the extractor's own dated rows for one alliance
  if (/^(north|south|west|central)$/i.test(clean))
    return { kind: 'raw', alliance: normAlliance(clean) };
  // "June 2026", "North September 2025"
  const m = clean.match(/^(north|south|west|central)?\s*([a-z]+)\s+((?:19|20)\d\d)$/i);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0)
      return { kind: 'month', alliance: m[1] ? normAlliance(m[1]) : '',
               month: `${m[3]}-${String(mi + 1).padStart(2, '0')}` };
  }
  // "FebNorth" — a month and an alliance run together, with no year. The year is the one the
  // workbook uses for that month; if the workbook has two of them, it cannot be told and the
  // tab is left for a person to place.
  const j = clean.match(/^([a-z]{3,9})\s*(north|south|west|central)$/i);
  if (j) {
    const mi = MONTHS.findIndex(m => m.startsWith(j[1].toLowerCase()));
    if (mi >= 0)
      return { kind: 'joined', alliance: normAlliance(j[2]), monthIndex: mi + 1,
               why: 'the name does not say which year' };
  }
  return { kind: 'unknown', why: 'the name does not say which month and year it is' };
}

/**
 * The Day 1 of each month, read back from boards that already exist.
 *
 * A board that has been saved carries both its date and which day of the event it was, so it
 * dates its own month exactly. That beats any rule: August 2026 ran Tuesday to Monday, not from
 * the fourth Monday, and only the board saved from that recording says so.
 */
export function day1sFromBoards(boards) {
  const back = { 'Day 1': 0, 'Day 4': 3, 'Final': FINAL_OFFSET };
  const out = new Map();
  for (const b of boards || []) {
    const off = back[b.label];
    if (off === undefined || !b.date) continue;
    const d1 = addDays(b.date, -off);
    const ym = d1.slice(0, 7);
    if (!out.has(ym)) out.set(ym, d1);
  }
  return out;
}

/** Given every real date seen, the Day 1 of each event: a date with no board three days before it. */
export function day1sFrom(dates) {
  const set = new Set(dates);
  const out = new Map();
  for (const d of [...set].sort()) {
    if (set.has(addDays(d, -3))) continue;
    const ym = d.slice(0, 7);
    if (!out.has(ym)) out.set(ym, d);
  }
  return out;
}

const LABEL_BY_OFFSET = { 0: 'Day 1', 3: 'Day 4', 6: 'Final' };
const FINAL_OFFSET = 6;

/**
 * Read every sheet and say what would be created.
 *
 * @param {{name, rows}[]} sheets
 * @param {object} o
 * @param {Array}  o.roster    to resolve names
 * @param {object} o.dates     month -> Day 1, whatever the user has changed
 * @returns {{ months, boards, skipped, unknown, day1s, totals }}
 */
export function planWorkbook(sheets, { roster = [], dates = {}, minRows = 3, existing = [] } = {}) {
  const skipped = [], unknown = [], rawBoards = [], monthTabs = [];

  // ---- the dated tabs first: they are the only place a real date exists -------------------
  // Which year each month belongs to, from the tabs that spell it out. A tab that names a
  // month but no year is placed by this; a month used in two years cannot be placed at all.
  const yearsFor = new Map();
  for (const s of sheets) {
    const c = classify(s.name);
    if (c.kind !== 'month') continue;
    const [y, m] = c.month.split('-');
    const set = yearsFor.get(+m) || new Set();
    set.add(y); yearsFor.set(+m, set);
  }

  for (const s of sheets) {
    const c = classify(s.name);
    if (c.kind === 'skip') { skipped.push({ name: s.name, why: c.why }); continue; }
    if (c.kind === 'joined') {
      const years = yearsFor.get(c.monthIndex);
      if (!years || years.size !== 1) {
        unknown.push({ name: s.name, why: years ? 'the workbook uses that month in more than one year' : c.why });
        continue;
      }
      c.kind = 'month';
      c.month = `${[...years][0]}-${String(c.monthIndex).padStart(2, '0')}`;
      c.inferred = true;
    }
    if (c.kind === 'unknown') { unknown.push({ name: s.name, why: c.why }); continue; }

    // A tab can hold several tables side by side. The first one that makes sense is the tab's
    // own; any table after it has to name its alliance, or there is no telling whose it is.
    const blocks = detectBlocks(s.rows);
    let primary = true, used = 0;
    const year = String(c.month || '').slice(0, 4);
    for (const b of blocks) {
      const layout = detectLayout(b.rows);
      if (!layout) continue;
      if (!primary && layout.alliance < 0) continue;
      let month = c.month;
      if (!primary) {
        // A second table titles itself with its month in the cell above the names.
        const title = String((b.rows[0] || [])[0] ?? '').trim().toLowerCase();
        const mi = MONTHS.indexOf(title);
        const yr = year || String(rawBoards[0]?.date || '').slice(0, 4);
        if (mi < 0 || !yr) continue;
        month = `${yr}-${String(mi + 1).padStart(2, '0')}`;
      }
      const label = blocks.length > 1 ? `${s.name} (table ${used + 1})` : s.name;
      if (layout.kind === 'flat')
        rawBoards.push(...buildBoards(b.rows, layout, { roster, alliance: c.alliance, source: label }));
      else if (month)
        monthTabs.push({ rows: b.rows, layout, alliance: c.alliance, month, source: label });
      else continue;
      used++; primary = false;
    }
    if (!used) unknown.push({ name: s.name, why: 'no Day 1 / Day 4 / Final columns, and no date column' });
  }

  // Every real date the workbook holds, and the Day 1 each event started on.
  const day1s = day1sFrom(rawBoards.map(b => b.date));
  // Boards already saved date their own month better than anything here can work out.
  const fromApp = day1sFromBoards(existing);
  const groupOf = date => [...day1s.values()].find(d =>
    date === d || date === addDays(d, 3) || date === addDays(d, FINAL_OFFSET)) || null;
  for (const b of rawBoards) {
    const d1 = groupOf(b.date);
    if (!d1) { b.month = b.date.slice(0, 7); continue; }
    const offset = Math.round((Date.parse(b.date) - Date.parse(d1)) / 86400000);
    b.label = b.label || LABEL_BY_OFFSET[offset] || null;
    b.month = d1.slice(0, 7);
  }

  // ---- then the month tabs, dated from the workbook where it knows and offered a default ---
  const monthsSeen = new Map();
  const dayBoards = [];
  for (const t of monthTabs) {
    const saved = fromApp.get(t.month) || null;
    const known = day1s.get(t.month) || null;
    const day1 = dates[t.month] || saved || known || fourthMonday(t.month);
    const from = dates[t.month] ? 'you' : saved ? 'saved' : known ? 'workbook' : 'monday';
    if (!monthsSeen.has(t.month))
      monthsSeen.set(t.month, { month: t.month, day1, known, saved, from, tabs: [], boards: 0, rows: 0 });
    const entry = monthsSeen.get(t.month);
    entry.day1 = day1;
    if (!entry.tabs.includes(t.source)) entry.tabs.push(t.source);
    const made = buildBoards(t.rows, t.layout, { day1, alliance: t.alliance, roster, source: t.source });
    for (const b of made) b.month = t.month;
    dayBoards.push(...made);
  }

  // ---- one board per date and alliance -----------------------------------------------------
  //
  // Two tabs describing the same board is the normal case, not a clash: a month tab and the
  // dated tab that fed it, or a month tab and the working copy somebody kept alongside it when
  // one alliance went missing from the first. Neither is a superset of the other — February's
  // main tab has scores its working copy left blank and the working copy has a whole alliance
  // the main tab lost — so the board is every player either of them recorded, and where both
  // hold the same player the more authoritative tab is believed.
  const byId = new Map();
  for (const b of [...rawBoards, ...dayBoards]) {
    if (!byId.has(boardId(b))) byId.set(boardId(b), []);
    byId.get(boardId(b)).push(b);
  }
  const merged = [];
  for (const [, list] of byId) {
    list.sort((a, b) => (b.precise - a.precise) || (b.rows.length - a.rows.length));
    const first = list[0];
    if (list.length === 1) { merged.push(first); continue; }
    const keyOf = r => (r.search || '').toLowerCase() || 'g:' + String(r.ingame || '').toLowerCase();
    const rows = new Map();
    for (const b of list) for (const r of b.rows) if (!rows.has(keyOf(r))) rows.set(keyOf(r), r);
    const all = [...rows.values()];
    const hasRanks = first.precise && all.every(r => r.place > 0);
    const ranked = hasRanks
      ? all.sort((a, b) => a.place - b.place)
      : all.sort((a, b) => b.points - a.points).map((r, i) => ({ ...r, place: i + 1 }));
    merged.push({
      ...first, rows: ranked,
      unmatched: ranked.filter(r => !r.matched).length,
      duplicates: list.reduce((n, b) => n + b.duplicates, 0),
      source: list.map(b => b.source).join(' + '),
      mergedFrom: list.map(b => ({ source: b.source, rows: b.rows.length })),
      added: ranked.length - first.rows.length,
    });
  }

  // Parked players are not an alliance, and a board of one or two stray cells is not a board.
  const excluded = [];
  const boards = [];
  for (const b of merged) {
    if (!b.month) b.month = b.date.slice(0, 7);
    if (isParked(b.alliance)) { excluded.push({ ...b, why: 'not a playing alliance' }); continue; }
    if (b.rows.length < minRows) { excluded.push({ ...b, why: `fewer than ${minRows} players` }); continue; }
    boards.push(b);
  }
  boards.sort((a, b) => a.date.localeCompare(b.date) || a.alliance.localeCompare(b.alliance));

  // Every month that ends up with a board, whether it came from a month tab or a dated one.
  const months = new Map();
  for (const b of boards) {
    if (!months.has(b.month)) {
      const m = monthsSeen.get(b.month);
      months.set(b.month, m
        ? { ...m, boards: 0, rows: 0, tabs: [] }
        : { month: b.month, day1: day1s.get(b.month) || fourthMonday(b.month),
            known: day1s.get(b.month) || null, saved: fromApp.get(b.month) || null,
            from: day1s.get(b.month) ? 'workbook' : 'monday', tabs: [], boards: 0, rows: 0 });
    }
    const m = months.get(b.month);
    if (!m.tabs.includes(b.source)) m.tabs.push(b.source);
    m.boards++; m.rows += b.rows.length;
  }

  return {
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
    boards,
    skipped, unknown, excluded,
    merged: merged.filter(b => b.mergedFrom),
    day1s: Object.fromEntries(day1s),
    totals: {
      boards: boards.length,
      rows: boards.reduce((n, b) => n + b.rows.length, 0),
      unmatched: boards.reduce((n, b) => n + b.unmatched, 0),
      duplicates: boards.reduce((n, b) => n + b.duplicates, 0),
      players: new Set(boards.flatMap(b => b.rows.map(r => r.search || r.ingame))).size,
    },
  };
}

export { toYmd };
