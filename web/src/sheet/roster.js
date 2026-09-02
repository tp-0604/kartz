// The roster, as a spreadsheet.
//
// The sheet keeps whatever columns it has, in whatever order it has them — a list copied from
// somewhere else should not have to be rearranged to suit this app. What the app needs is three
// of those columns, and it finds them by heading: which one is the identity every score points
// at, which is the name a recording is matched against, and which is the alliance. Everything
// else is the roster's own and is kept without being read.
//
// The headings are read back out of the sheet on every save, so renaming a column, adding one
// or moving one is simply what the roster now is.
export const HEADER_ROW = 0;
export const DEFAULT_MAPPING = { search: 'Player', ingame: 'Name in video', alliance: 'Alliance' };
const NAME_WIDTH = 190, WIDTH = 130;

// A player called 141 is not the number 141: a name column is formatted as text so it keeps its
// leading zeros and stays the string every score points at.
export const columnSpec = (columns, mapping) => columns.map(h => ({
  header: h,
  width: h === mapping.search || h === mapping.ingame ? NAME_WIDTH : WIDTH,
  numberFormat: (h === mapping.search || h === mapping.ingame || h === mapping.alliance) ? '@' : null,
}));

const text = v => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'v' in v) return text(v.v);
  return String(v).trim();
};

/** Records to a 2-D block: the heading row, then one row per player, in the sheet's own order. */
export function toSheetValues(rows, columns, mapping) {
  const at = (r, h) => h === mapping.search ? r.search
    : h === mapping.ingame ? r.ingame
    : h === mapping.alliance ? (r.alliance || '')
    : ((r.extra && r.extra[h]) ?? '');
  return [columns.slice(), ...rows.map(r => columns.map(h => at(r, h)))];
}

/**
 * A 2-D block back to records, with the headings the sheet now carries.
 * @param {any[][]} values
 * @param {{search, ingame, alliance}} mapping  which headings are the three the app needs
 * @returns {{ rows, columns, mapping, blanks, missing }}
 */
export function fromSheetValues(values, mapping = DEFAULT_MAPPING) {
  const head = (values[HEADER_ROW] || []).map(text);
  // A column earns its place by having a heading. An unheaded column of stray notes is not a
  // column of the roster, and calling it "Column 7" would make it one.
  const width = head.reduce((w, h, i) => (h ? i + 1 : w), 0);
  const columns = head.slice(0, width);

  // The three the app needs are found by heading. A heading renamed in the sheet falls back to
  // the position it was in, so a rename does not quietly detach the identity column.
  const find = (want, fallbackIndex) => {
    const i = want ? columns.indexOf(want) : -1;
    if (i >= 0) return i;
    return fallbackIndex < columns.length ? fallbackIndex : -1;
  };
  const iSearch = find(mapping.search, 0);
  const iIngame = find(mapping.ingame, 1);
  const iAlliance = find(mapping.alliance, 2);

  const nextMapping = {
    search: columns[iSearch] || mapping.search,
    ingame: columns[iIngame] || '',
    alliance: columns[iAlliance] || '',
  };

  const rows = [];
  let blanks = 0;
  for (let i = HEADER_ROW + 1; i < values.length; i++) {
    const row = values[i] || [];
    const search = iSearch >= 0 ? text(row[iSearch]) : '';
    const ingame = iIngame >= 0 ? text(row[iIngame]) : '';
    const alliance = iAlliance >= 0 ? text(row[iAlliance]) : '';
    const extra = {};
    for (let c = 0; c < columns.length; c++) {
      if (c === iSearch || c === iIngame || c === iAlliance) continue;
      const v = text(row[c]);
      if (v) extra[columns[c]] = v;
    }
    if (!search) {
      // A row carrying something but no player name is a mistake worth reporting; an entirely
      // empty row is just the bottom of the sheet.
      if (ingame || alliance || Object.keys(extra).length) blanks++;
      continue;
    }
    rows.push({ search, ingame: ingame || search, alliance: alliance || null, extra, sheetRow: i });
  }
  return { rows, columns, mapping: nextMapping, blanks, missing: iSearch < 0 };
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

/** A guess at which columns of an unfamiliar table are the three the app needs. */
export function guessMapping(headings) {
  const hit = re => headings.find(h => re.test(h)) || '';
  const search = hit(/^(search(able)?|player|member)\s*name$/i) || hit(/^(player|name)$/i)
              || hit(/search/i) || headings[0] || '';
  let ingame = hit(/name in video|in.?game\s*name|game name/i) || hit(/in.?game/i);
  if (!ingame || ingame === search) ingame = headings.find(h => h !== search) || '';
  const alliance = hit(/^(current\s*)?alliance$/i) || hit(/alliance|guild|team/i);
  return { search, ingame, alliance: alliance === search || alliance === ingame ? '' : alliance };
}
