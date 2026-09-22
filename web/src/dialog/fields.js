/**
 * Which column on the sheet holds what.
 *
 * The extractor always produces the same five things — a rank, the roster name, the name the
 * game drew, an alliance and a score. The sheet they go into is whatever somebody made, with
 * headings in their own words, in their own order, possibly with columns in between that have
 * nothing to do with any of this.
 *
 * So the mapping is guessed from the headings and then shown, because a guess you can see and
 * correct is worth more than a clever one you cannot. A column nobody mapped is left alone:
 * new rows get an empty string there, which keeps its formula or its formatting intact.
 */

export const FIELDS = [
  { id: 'place', label: 'Rank', about: 'the position the game showed' },
  { id: 'search', label: 'Roster name', about: 'the name on the roster' },
  { id: 'ingame', label: 'Game name', about: 'the name the video drew' },
  { id: 'alliance', label: 'Alliance', about: 'the player’s own alliance' },
  { id: 'points', label: 'Score', about: 'the number beside them' },
  { id: 'date', label: 'Date', about: 'the day the board was filmed' },
  { id: 'label', label: 'Label', about: 'Day 1, Day 4, Final — whatever you call it' },
];

const TESTS = [
  ['place', [/^#$/, /\brank\b/, /\bplace\b/, /\bpos(ition)?\b/, /^no\.?$/]],
  ['search', [/search/, /roster name/, /^name$/, /player/, /member/]],
  ['ingame', [/in ?game/, /game ?name/, /display/, /shown/]],
  ['alliance', [/alliance/, /^team$/, /^clan$/]],
  ['points', [/points?/, /score/, /\bcp\b/, /power/, /fame/, /total/]],
  ['date', [/date/, /\bday\b(?!\s*\d)/, /when/]],
  ['label', [/label/, /round/, /stage/, /snapshot/, /^day \d/]],
];

const clean = h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A guess at which heading means which field.
 *
 * Returns one entry per column of the sheet: the heading as written, and the field it looks
 * like, or null. The first heading that matches a field wins it, so a sheet with both "Name"
 * and "Game Name" does not give both to the same thing.
 */
export function guessFields(headers) {
  const taken = new Set();
  const out = (headers || []).map(h => ({ header: String(h || ''), field: null }));

  // The most specific tests first, so "Game Name" is not claimed by the plain /^name$/.
  for (const [field, tests] of TESTS) {
    for (let i = 0; i < out.length; i++) {
      if (out[i].field || taken.has(field)) continue;
      const h = clean(out[i].header);
      if (!h) continue;
      if (tests.some(t => t.test(h))) { out[i].field = field; taken.add(field); break; }
    }
  }
  return out;
}

/** Which of the things the extractor produces this sheet has nowhere to put. */
export function unmapped(mapping) {
  const has = new Set((mapping || []).map(m => m.field).filter(Boolean));
  return FIELDS.filter(f => !has.has(f.id) && f.id !== 'label' && f.id !== 'date')
    .map(f => f.label);
}

/**
 * One extracted row, laid out the way this sheet's columns are.
 *
 * A column with no field gets an empty string — not a space, not a zero — so nothing is
 * written over and a formula column keeps whatever it already computes.
 */
export function toSheetRow(row, mapping, extra = {}) {
  return (mapping || []).map(({ field }) => {
    if (!field) return '';
    if (field === 'date') return extra.date || '';
    if (field === 'label') return extra.label || '';
    const v = row[field];
    return v === null || v === undefined ? '' : v;
  });
}

/** The columns a duplicate is judged on: a name, and whatever else makes a row unique here. */
export function keyColumns(mapping, extra = {}) {
  const keys = [];
  const nameCol = (mapping || []).find(m => m.field === 'search')
    || (mapping || []).find(m => m.field === 'ingame');
  if (nameCol) keys.push(nameCol.header);
  if (extra.date) {
    const dateCol = (mapping || []).find(m => m.field === 'date');
    if (dateCol) keys.push(dateCol.header);
  }
  return keys;
}

/** What a duplicate check compares: the candidate row, keyed by heading rather than by field. */
export function toKeyed(row, mapping, extra = {}) {
  const out = {};
  (mapping || []).forEach(({ header, field }) => {
    if (!field || !header) return;
    out[String(header).trim().toLowerCase()] =
      field === 'date' ? (extra.date || '')
      : field === 'label' ? (extra.label || '')
      : (row[field] === null || row[field] === undefined ? '' : row[field]);
  });
  return out;
}
