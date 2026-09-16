// The spreadsheet round trip, without the spreadsheet: rows → block → edited block → operations.
import { toBlock, diffBlock, ID_HEADER } from '../web/src/sheet/sheetRows.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const columns = [
  { key: 'place',   header: 'Rank',         type: 'int',  role: 'record' },
  { key: 'search',  header: 'Player',       type: 'text', role: 'record' },
  { key: 'points',  header: 'Kartz Points', type: 'int',  role: 'record' },
  { key: 'x:Notes', header: 'Notes',        type: 'text', role: 'extra' },
];
const rows = [
  { id: 'a', __sort: 1, place: 1, search: 'Neaira',  points: 1070, 'x:Notes': null },
  { id: 'b', __sort: 2, place: 2, search: 'BigMark', points: 1040, 'x:Notes': 'ok' },
  { id: 'c', __sort: 3, place: 3, search: '007',     points: 935,  'x:Notes': null },
];
const ids = () => { let n = 0; return () => 'n' + (++n); };
const copy = block => block.map(line => line.slice());
const diff = (block, kind = 'board') => diffBlock(block, columns, rows, { kind, newId: ids() });

console.log('\n# building the block');
const block = toBlock(columns, rows);
ok('the id column comes first', block[0][0] === ID_HEADER && block[0][1] === 'Rank', block[0]);
ok('one line per row, id first', block.length === 4 && block[2][0] === 'b' && block[2][3] === 1040, block);

console.log('\n# nothing changed');
ok('an untouched sheet sends nothing', diff(block).ops.length === 0, diff(block).ops);
let b = copy(block); b[3][2] = 7;
ok('"007" read back as the number 7 is not an edit', diff(b).ops.length === 0, diff(b).ops);
b = copy(block); b[1][3] = '1,070';
ok('a number with a separator is the same number', diff(b).ops.length === 0, diff(b).ops);

console.log('\n# edits');
b = copy(block); b[2][3] = 1050; b[2][4] = '';
let d = diff(b);
ok('a changed row is one update with only what changed',
   d.ops.length === 1 && d.ops[0].op === 'update' && d.ops[0].id === 'b'
   && d.ops[0].values.points === 1050 && d.ops[0].values['x:Notes'] === null
   && Object.keys(d.ops[0].values).length === 2, d.ops);

b = [block[0], block[3], block[1], block[2]]; b = copy(b); b[1][3] = 999;
d = diff(b);
ok('a sorted sheet still edits the right row', d.ops.length === 1 && d.ops[0].id === 'c' && d.ops[0].values.points === 999, d.ops);

console.log('\n# rows added and removed');
b = copy(block); b.push(['', 4, 'Late', 10, 'new']);
d = diff(b);
ok('a line with no id is an insert', d.ops.length === 1 && d.ops[0].op === 'insert' && d.ops[0].id === 'n1'
   && d.ops[0].sort === 4 && d.ops[0].values.place === 4 && d.ops[0].values['x:Notes'] === 'new', d.ops);
ok('its line is reported so the id can be written back', d.inserted.length === 1 && d.inserted[0].line === 4, d.inserted);

b = copy(block); b.push(['', '', '', '', '']);
ok('a blank line is not a row', diff(b).ops.length === 0, diff(b).ops);

b = copy(block); b.push(copy(block)[1]);
d = diff(b);
ok('a copied row, id and all, becomes a new row', d.counts.inserted === 1 && d.counts.updated === 0 && d.counts.deleted === 0, d);

b = copy(block); b.splice(3, 1);
d = diff(b);
ok('a row gone from the sheet is a delete', d.ops.length === 1 && d.ops[0].op === 'delete' && d.ops[0].id === 'c'
   && d.counts.deleted === 1, d);

console.log('\n# columns');
b = copy(block); b[0].push('CP'); b[1].push('91'); b[2].push(''); b[3].push('');
d = diff(b);
ok('a new heading is a column, sent before the values', d.ops[0].op === 'columns'
   && JSON.stringify(d.ops[0].columns) === JSON.stringify(['Notes', 'CP'])
   && d.ops[1].op === 'update' && d.ops[1].values['x:CP'] === '91' && d.counts.columns === 1, d.ops);
ok('the roster sends every heading it has', diff(b, 'roster').ops[0].columns.length === 5, diff(b, 'roster').ops[0]);

b = copy(block).map(line => line.slice(0, 4));
ok('a column removed from the sheet is left alone', diff(b).ops.length === 0, diff(b).ops);

console.log('\n# safety');
b = copy(block).map(line => line.slice(1));
let threw = null;
try { diff(b); } catch (e) { threw = e; }
ok('without the id column it refuses rather than deleting everything', !!threw && /row id/.test(threw.message), threw && threw.message);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
