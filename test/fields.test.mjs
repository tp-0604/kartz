// Which column on the sheet holds what. Every one of these workbooks names its headings
// differently, so the guessing is the part that has to be right — and the part that quietly
// breaks a sheet if it is wrong, by writing a score into a formula column.
import { guessFields, unmapped, toSheetRow, keyColumns, toKeyed } from '../web/src/dialog/fields.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const fields = headers => guessFields(headers).map(m => m.field);

console.log('\n# reading the headings');
ok('the plain case',
   fields(['Place', 'Searchable Name', 'Game Name', 'Alliance', 'Points', 'Date']).join() ===
   'place,search,ingame,alliance,points,date');

ok('"Name" alone is the roster name, and "Game Name" is not taken by it',
   fields(['#', 'Name', 'Game Name', 'Team', 'Score']).join() === 'place,search,ingame,alliance,points');

ok('a heading nobody asked about is left alone',
   fields(['Rank', 'Player', 'Notes', 'Points']).join() === 'place,search,,points');

ok('two headings cannot claim the same field',
   fields(['Points', 'Score', 'Total']).filter(f => f === 'points').length === 1,
   fields(['Points', 'Score', 'Total']));

ok('empty headings are never mapped', fields(['', '  ', 'Points']).join() === ',,points');
ok('no headings at all is not a crash', guessFields(undefined).length === 0);

console.log('\n# what the sheet has nowhere to put');
ok('a sheet with no score column, and no in-game one, says both',
   unmapped(guessFields(['Rank', 'Name', 'Alliance'])).join() === 'Game name,Score',
   unmapped(guessFields(['Rank', 'Name', 'Alliance'])));
ok('a date column is not required', unmapped(guessFields(['Rank', 'Name', 'In Game', 'Alliance', 'Points'])).length === 0);

console.log('\n# laying a row out the way the sheet is');
const mapping = guessFields(['Place', 'Searchable Name', 'Formula', 'Alliance', 'Points', 'Date']);
const row = { place: 3, search: 'Glitter', ingame: 'Glitter', alliance: '698W', points: 498 };
const out = toSheetRow(row, mapping, { date: '2026-09-22', label: 'Day 1' });

ok('the values land in the sheet\'s own order',
   out.join('|') === '3|Glitter||698W|498|2026-09-22', out);
ok('the unmapped column gets an empty string, not a space or a zero', out[2] === '', JSON.stringify(out[2]));
ok('a row with nothing for a mapped field still fills the cell',
   toSheetRow({ place: 1 }, mapping, {})[1] === '', toSheetRow({ place: 1 }, mapping, {}));
ok('a zero score survives — it is a number, not an absence',
   toSheetRow({ ...row, points: 0 }, mapping, {})[4] === 0);

console.log('\n# what counts as the same row');
ok('the name column, and the date when there is one',
   keyColumns(mapping, { date: '2026-09-22' }).join() === 'Searchable Name,Date');
ok('without a date, the name alone', keyColumns(mapping, {}).join() === 'Searchable Name');
ok('with no roster-name column, the in-game one stands in',
   keyColumns(guessFields(['Rank', 'Game Name', 'Points']), {}).join() === 'Game Name');

const keyed = toKeyed(row, mapping, { date: '2026-09-22' });
ok('a candidate is keyed by heading, lowercased, as the sheet reads it',
   keyed['searchable name'] === 'Glitter' && keyed.date === '2026-09-22', keyed);
ok('an unmapped heading is not a key', !('formula' in keyed), Object.keys(keyed));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
