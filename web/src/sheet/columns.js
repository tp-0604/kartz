// The column contract between the app and the workbook.
//
// Columns A–E are the record: what the database stores and what every other view reads.
// Anything the user adds to the right of E is theirs — a note, a formula, a ratio — and lives
// only in the workbook snapshot. It is never parsed, and never lost either.
export const COLUMNS = [
  { key: 'place',    header: 'Rank',          width: 64,  numberFormat: '0',     kind: 'int' },
  { key: 'search',   header: 'Player',        width: 170,                       kind: 'text' },
  { key: 'ingame',   header: 'Name in video', width: 190,                       kind: 'text' },
  { key: 'alliance', header: 'Alliance',      width: 90,                        kind: 'text' },
  { key: 'points',   header: 'Kartz Points',  width: 110, numberFormat: '#,##0', kind: 'int' },
];
export const HEADER_ROW = 0;

const clean = v => (v === null || v === undefined ? '' : v);

// Records → 2-D array, one row per record, in column order.
export function toSheetRows(records, columns = COLUMNS) {
  return records.map(r => columns.map(c => {
    const v = clean(r[c.key]);
    return c.kind === 'int' && v !== '' ? Number(v) : v;
  }));
}

// 2-D array (header included) → records. A row with no rank and no name is blank and skipped;
// a row with one but not the other is kept so the save can say what is wrong with it.
export function fromSheetRows(values, columns = COLUMNS) {
  const out = [];
  for (let i = HEADER_ROW + 1; i < values.length; i++) {
    const row = values[i] || [];
    const rec = {};
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      let v = row[c];
      if (v && typeof v === 'object' && 'v' in v) v = v.v;       // a cell object, not a value
      v = clean(v);
      if (col.kind === 'int') {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
        rec[col.key] = v === '' || !Number.isFinite(n) ? null : Math.round(n);
      } else {
        rec[col.key] = String(v).trim() || null;
      }
    }
    rec.sheetRow = i;
    if (rec.place === null && !rec.ingame && !rec.search && rec.points === null) continue;
    out.push(rec);
  }
  return out;
}

// What the Worker stores. A row that differs from the one it was loaded as is marked edited, so
// a later re-extraction of the same recording keeps the correction rather than undoing it.
export function toRecords(sheetRecords, baseline) {
  const base = new Map((baseline || []).map(r => [r.place, r]));
  return sheetRecords.map(r => {
    const b = base.get(r.place);
    const changed = !b || b.search !== r.search || b.ingame !== r.ingame
                 || (b.alliance || null) !== (r.alliance || null) || b.points !== r.points;
    return {
      place: r.place, search: r.search, ingame: r.ingame,
      alliance: r.alliance, points: r.points,
      edited: changed ? 1 : (b && b.edited ? 1 : 0),
    };
  });
}

// The problems a save would hit, said in the user's terms before the request is made.
export function validate(records) {
  const problems = [];
  const seen = new Map();
  for (const r of records) {
    const where = `row ${r.sheetRow + 1}`;
    if (!(r.place > 0)) problems.push(`${where} has no rank`);
    else if (seen.has(r.place)) problems.push(`rank ${r.place} appears twice (rows ${seen.get(r.place) + 1} and ${r.sheetRow + 1})`);
    else seen.set(r.place, r.sheetRow);
    if (!r.ingame) problems.push(`${where} has no name in the "Name in video" column`);
    if (r.points === null) problems.push(`${where} has no points`);
  }
  return problems;
}

// From a reviewed extractor row to a record. The same mapping the old saveRun() made: the
// roster name is the identity, null for somebody new; the drawn name is kept because it changes.
export function extractedToRecord(r, outName) {
  return {
    place:    r.rank,
    search:   r.match ? r.match.search : null,
    ingame:   r.name || outName(r),
    alliance: r.alliancePick || (r.match ? (r.match.alliance || null) : null),
    points:   r.points,
    edited:   0,
  };
}
