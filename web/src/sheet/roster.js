// The roster, as a spreadsheet.
//
// Three columns are the app's: the searchable name is a player's identity and is what every
// score points at, the in-game name is what the video draws, and the alliance is whose they
// are. Everything to the right of those is the roster's own — CP, march types, notes — and the
// app does not read it, only keeps it.
//
// Which is why the headings are read back out of the sheet on save rather than fixed in code:
// rename a column, add one, drop one, and the roster is whatever the sheet now says it is.
// A player called 141 or 507 is not the number 141: formatted as text, a name keeps its
// leading zeros and stays the string every score points at.
export const FIXED = [
  { key: 'search',   header: 'Player',        width: 180, numberFormat: '@' },
  { key: 'ingame',   header: 'Name in video', width: 200, numberFormat: '@' },
  { key: 'alliance', header: 'Alliance',      width: 110, numberFormat: '@' },
];
export const HEADER_ROW = 0;
const EXTRA_WIDTH = 130;

/** The columns a sheet should be drawn with, given the extra headings the roster carries. */
export function sheetColumns(extra = [], labels = []) {
  const fixed = FIXED.map((c, i) => ({ ...c, header: labels[i] || c.header }));
  return [...fixed, ...extra.map(h => ({ key: 'x:' + h, header: h, width: EXTRA_WIDTH }))];
}

/** Records to a 2-D block: the header row, then one row per player. */
export function toSheetValues(rows, columns) {
  const head = columns.map(c => c.header);
  const body = rows.map(r => columns.map(c => (
    c.key.startsWith('x:') ? (r.extra && r.extra[c.key.slice(2)]) ?? '' : r[c.key] ?? ''
  )));
  return [head, ...body];
}

const text = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'v' in v) return text(v.v);
  return String(v).trim();
};

/**
 * A 2-D block back to records, with the headings the sheet now carries.
 * @returns {{ rows, columns, labels, blanks }}
 */
export function fromSheetValues(values) {
  const head = (values[HEADER_ROW] || []).map(text);
  // A column earns its place by having a heading. An unheaded column of stray notes is not a
  // column of the roster, and naming it "Column 7" would make it one.
  const width = head.reduce((w, h, i) => (h ? i + 1 : w), 0);
  const labels = head.slice(0, 3);
  const columns = head.slice(3, width).filter(Boolean);
  const rows = [];
  let blanks = 0;
  for (let i = HEADER_ROW + 1; i < values.length; i++) {
    const row = values[i] || [];
    const search = text(row[0]);
    const ingame = text(row[1]);
    const alliance = text(row[2]);
    const extra = {};
    for (let c = 0; c < columns.length; c++) {
      const v = text(row[3 + c]);
      if (v) extra[columns[c]] = v;
    }
    if (!search) {
      // A row with a name in it but no player name is a mistake worth reporting; an entirely
      // empty row is just the bottom of the sheet.
      if (ingame || alliance || Object.keys(extra).length) blanks++;
      continue;
    }
    rows.push({ search, ingame: ingame || search, alliance: alliance || null, extra, sheetRow: i });
  }
  return { rows, columns, labels, blanks };
}

/**
 * What a save would be refused for, said before it is attempted.
 *
 * A player name is the identity every score points at, so two rows cannot share one — the
 * second would simply not be stored. Case is not a clash: Anubis and anubis are two people in
 * two alliances, and the database keeps them apart.
 */
export function validate(rows) {
  const problems = [];
  const seen = new Map();
  for (const r of rows) {
    if (seen.has(r.search))
      problems.push(`“${r.search}” is on row ${seen.get(r.search) + 1} and again on row ${r.sheetRow + 1}`);
    else seen.set(r.search, r.sheetRow);
  }
  return problems;
}
