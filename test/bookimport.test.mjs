// Deciding what a sheet is, finding the table in it, and packing the grid to be sent.
import { gunzipSync, strFromU8 } from '../web/node_modules/fflate/esm/browser.js';
import { findTable, detectShape, projectRows, packBands, planImport, sendImport }
  from '../web/src/services/bookImport.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const cell = (r, c, v, t = typeof v === 'number' ? 'n' : 'str', s = 0) => [r, c, v, t, null, s];
const painted = (r, c, s = 1) => [r, c, null, '', null, s];

/* ---------------------------------------------------------------------- finding the table */
console.log('\n# where the table starts');
const responses = [
  cell(0, 0, 'Timestamp'), cell(0, 1, 'In game name'), cell(0, 2, 'Alliance'), cell(0, 3, 'Class'),
  cell(1, 0, '9/6 16:02'), cell(1, 1, 'Sandeep'), cell(1, 2, '698C'), cell(1, 3, 'Combat Elite'),
  cell(2, 0, '9/6 16:10'), cell(2, 1, 'RayLim'), cell(2, 2, '698C'), cell(2, 3, 'Combat Elite'),
  cell(3, 0, '9/6 16:58'), cell(3, 1, 'Niya'), cell(3, 2, '698C'), cell(3, 3, 'Mechanical Master'),
  cell(4, 0, '9/6 17:12'), cell(4, 1, 'GreyBear'), cell(4, 2, '698C'), cell(4, 3, 'Combat Elite'),
];
let t = findTable(responses);
ok('a header row and its body are found',
   t && t.headerRow === 0 && t.rows === 4 && t.lastCol === 3, t);
ok('and the headings are read off it',
   t.columns.map(c => c.header).join() === 'Timestamp,In game name,Alliance,Class', t.columns);

const titled = [
  cell(0, 0, 'Sign ups — September'),
  cell(2, 1, 'Name'), cell(2, 2, 'Class'), cell(2, 3, 'CP'),
  cell(3, 1, 'AceAce'), cell(3, 2, 'MM'), cell(3, 3, 80),
  cell(4, 1, 'Shooter'), cell(4, 2, 'MM'), cell(4, 3, 116),
  cell(5, 1, 'Zemirka'), cell(5, 2, 'CE'), cell(5, 3, 196),
];
t = findTable(titled);
ok('a title above the table does not become the header',
   t && t.headerRow === 2 && t.firstCol === 1 && t.rows === 3, t);

const sparse = [
  cell(0, 0, 'Name:'), cell(0, 1, 'Sign Up:'), cell(0, 2, 'TC Date:'), cell(0, 3, 'Points:'),
  cell(0, 9, 'Sign Up:'), cell(0, 10, 'TC Date:'), cell(0, 11, 'Points:'),
  cell(1, 0, '507'), cell(1, 1, 'Google Form'), cell(1, 9, 'Google Form'),
  cell(2, 0, 'Bandit'), cell(2, 1, 'Google Form'), cell(2, 3, 23594),
  cell(3, 0, 'artu'), cell(3, 1, 'Google Form'), cell(3, 10, '1/24/2026'),
];
t = findTable(sparse);
ok('a wide sheet whose rows fill only a few columns is still a table',
   t && t.headerRow === 0 && t.rows === 3, t);
ok('a heading that repeats across the blocks is numbered rather than overwritten',
   Object.keys(projectRows(sparse, t)[0].data).join() === 'Name:,Sign Up:,Sign Up: 2',
   projectRows(sparse, t)[0]);

ok('a sheet with nothing in it has no table', findTable([]) === null);
ok('three scattered words are not a table',
   findTable([cell(0, 0, 'notes'), cell(3, 4, 'todo'), cell(9, 1, 'later')]) === null);

/* ------------------------------------------------------------------------------ the shape */
console.log('\n# what kind of sheet this is');
ok('a form response sheet is a table',
   detectShape({ cells: responses, merges: [] }, findTable(responses)) === 'table');
ok('an empty tab says so', detectShape({ cells: [], merges: [] }, null) === 'empty');

const calendar = [
  cell(0, 0, 'August Silo/Ruin Calendar'),
  cell(1, 1, 'Su'), cell(1, 2, 'Mo'), cell(1, 3, 'Tu'), cell(1, 4, 'We'),
  cell(2, 4, 1), cell(3, 1, 2), cell(3, 2, 3), cell(3, 8, 'Silos (1st-N)'),
  cell(4, 1, 9), cell(4, 2, 10), cell(4, 9, 'Ruin Swap'),
  cell(5, 1, 16), cell(5, 2, 17),
];
ok('a month grid under a banner is a drawing, however neatly it lines up',
   detectShape({ cells: calendar, merges: ['A1:J1'] }, findTable(calendar)) === 'layout',
   detectShape({ cells: calendar, merges: ['A1:J1'] }, findTable(calendar)));

const map = [cell(0, 0, 'DR building'), cell(0, 1, 'Finest'), cell(0, 2, 'Phil'),
             cell(1, 0, 'Tech 1'), cell(1, 1, 'BigSexy P'), painted(2, 0), painted(2, 1),
             painted(2, 2), painted(3, 0), painted(3, 1), painted(3, 2)];
ok('a squad map, mostly painted cells, is a drawing',
   detectShape({ cells: map, merges: [] }, findTable(map)) === 'layout');

const wide = responses.concat([painted(9, 9), painted(9, 10)]);
ok('a table with a little paint on it is still a table',
   detectShape({ cells: wide, merges: [] }, findTable(wide)) === 'table');

/* ------------------------------------------------------------------------- the projection */
console.log('\n# the rows a table becomes');
const rows = projectRows(responses, findTable(responses));
ok('one object per row, keyed by heading',
   rows.length === 4 && rows[0].data['In game name'] === 'Sandeep'
   && rows[0].data.Alliance === '698C', rows[0]);
ok('and each remembers which sheet row it was', rows[3].r === 4 && rows[3].idx === 3, rows[3]);

/* ------------------------------------------------------------------------------- the bands */
console.log('\n# the grid, cut into bands');
const many = [];
for (let r = 0; r < 1200; r++) many.push(cell(r, 0, 'row ' + r));
const bands = packBands(many);
ok('five hundred rows to a band', bands.length === 3 && bands.map(b => b.count).join() === '500,500,200',
   bands.map(b => [b.band, b.count]));
ok('each one is gzipped and comes back as it went in',
   JSON.parse(strFromU8(gunzipSync(Uint8Array.from(atob(bands[1].cells), c => c.charCodeAt(0)))))[0][0] === 500,
   bands[1].bytes);
ok('and is far smaller than the JSON it holds', bands[0].bytes < 3000, bands[0].bytes);
ok('a sheet with no cells packs to nothing', packBands([]).length === 0);

/* --------------------------------------------------------------------- planning and sending */
console.log('\n# a whole workbook, planned and sent');
const book = {
  styles: [{}, { bold: true, fill: '#00FF00' }],
  report: { formulas: 2, google: 3, errors: 1, images: 0 },
  sheets: [
    { name: 'Form Responses', idx: 0, cells: responses, merges: [], cols: [{ min: 0, max: 0, width: 160 }],
      rows: [], validations: [{ sqref: 'C2:C9', type: 'list', formula1: '"698N,698S"' }],
      condFmts: [], hyperlinks: [], images: [], dim: { rows: 5, cols: 4 }, frozen: { rows: 1, cols: 0 },
      tabColor: '#4472C4', defaults: {} },
    { name: 'Map', idx: 1, cells: map, merges: ['A1:C1'], cols: [], rows: [], validations: [],
      condFmts: [], hyperlinks: [], images: [], dim: { rows: 4, cols: 3 }, frozen: null,
      tabColor: null, defaults: {} },
    { name: 'Notes', idx: 2, skipped: true, cells: [] },
  ],
};
const plan = await planImport(book, { name: 'Titan Sign Up', sourceName: 'Titan Sign Up.xlsx' });
ok('a plan has one entry per tab that was read', plan.sheets.length === 2, plan.sheets.map(s => s.name));
ok('each with the shape it was judged to be',
   plan.sheets[0].shape === 'table' && plan.sheets[1].shape === 'layout',
   plan.sheets.map(s => [s.name, s.shape]));
ok('what is drawn around the grid travels beside it',
   plan.sheets[0].meta.cols.length === 1 && plan.sheets[0].meta.validation.length === 1
   && plan.sheets[1].meta.merges[0] === 'A1:C1', plan.sheets[0].meta);
ok('the report says what the reader found',
   plan.report.google === 3 && plan.report.errors === 1 && plan.report.sheets === 2
   && plan.report.tables === 1 && plan.report.layouts === 1, plan.report);
ok('and says plainly what a Sheets-only function cost',
   plan.report.notes.some(n => /Sheets-only/.test(n)), plan.report.notes);
ok('a tab that was not read is noted rather than dropped in silence',
   plan.report.notes.some(n => /Notes: not read/.test(n)), plan.report.notes);

const sent = [];
const api = async (method, path, body) => {
  sent.push(method + ' ' + path);
  if (method === 'POST' && path === '/files') return { file: { id: 'fl_1' } };
  if (/\/sheets$/.test(path)) return { sheet: { id: 'sh_' + sent.length } };
  if (/\/done$/.test(path)) return { sheets: 2, cells: 31 };
  return {};
};
const out = await sendImport(plan, api);
ok('sending makes the file, then its styles, then each tab',
   sent[0] === 'POST /files' && sent[1] === 'PUT /files/fl_1/styles'
   && sent[2] === 'POST /files/fl_1/sheets', sent.slice(0, 4));
ok('every band and every kind of meta is sent',
   sent.filter(x => /\/slab$/.test(x)).length === 2
   && sent.filter(x => /\/meta$/.test(x)).length === 3, sent.filter(x => /slab|meta/.test(x)));
ok('and the file is finished last', sent[sent.length - 1] === 'POST /files/fl_1/done', sent.slice(-1));
ok('the caller is told what landed', out.fileId === 'fl_1' && out.cells === 31, out);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
