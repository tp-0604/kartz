// What a stored sheet turns into on screen, and what it turns into inside the spreadsheet engine.
import { cellCss, isDateFormat, parseSqref, prepareRules, prepareValidation, ruleCss, show, validationAt }
  from '../web/src/files/sheetStyle.js';
import { fromUniver, fromUniverStyle, toUniver, toUniverStyle } from '../web/src/files/univerBridge.js';
import { layout, readMerges, refOf, fromRef, bandsFor } from '../web/src/files/bands.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const cell = (r, c, v, t = typeof v === 'number' ? 'n' : 'str', s = 0, f = null) => [r, c, v, t, f, s];

/* ------------------------------------------------------------------ naming a cell */
console.log('\n# where a cell is');
ok('a cell knows its address', refOf(0, 0) === 'A1' && refOf(6, 1) === 'B7' && refOf(0, 26) === 'AA1');
ok('and can be found from one', JSON.stringify(fromRef('B7')) === '{"r":6,"c":1}');
ok('a sloppy reference still reads', JSON.stringify(fromRef('$b$7')) === '{"r":6,"c":1}');
ok('and nonsense does not', fromRef('hello') === null);
ok('bands cover the rows asked for', bandsFor(0, 1200).join() === '0,1,2', bandsFor(0, 1200));

/* ------------------------------------------------------------------- showing a value */
console.log('\n# what a value looks like');
ok('a date format is recognised', isDateFormat('yyyy-mm-dd') && !isDateFormat('#,##0.00'));
ok('a serial number becomes a date',
   show(cell(0, 0, 46100, 'n'), { numFmt: 'yyyy-mm-dd' }) === '2026-03-19',
   show(cell(0, 0, 46100, 'n'), { numFmt: 'yyyy-mm-dd' }));
ok('a percentage is shown as one',
   show(cell(0, 0, 0.517, 'n'), { numFmt: '0.0%' }) === '51.7%', show(cell(0, 0, 0.517, 'n'), { numFmt: '0.0%' }));
ok('a thousands format gets its separators',
   show(cell(0, 0, 15769, 'n'), { numFmt: '#,##0' }).replace(/ /g, ',') === '15,769',
   show(cell(0, 0, 15769, 'n'), { numFmt: '#,##0' }));
ok('an error is left as the error it is', show(cell(0, 0, '#N/A', 'e'), null) === '#N/A');
ok('a boolean reads as one', show(cell(0, 0, true, 'b'), null) === 'TRUE');
ok('an empty cell shows nothing', show(cell(0, 0, null, ''), { fill: '#fff' }) === '');
ok('a long decimal is not shown to fifteen places',
   show(cell(0, 0, 0.1 + 0.2, 'n'), null) === '0.3', show(cell(0, 0, 0.1 + 0.2, 'n'), null));

console.log('\n# what a style looks like');
let css = cellCss({ bold: true, fill: '#00FF00', color: '#FF0000', align: 'center', wrap: true, size: 14 });
ok('a style becomes CSS the browser knows',
   css.fontWeight === 700 && css.background === '#00FF00' && css.textAlign === 'center'
   && css.whiteSpace === 'normal' && css.fontSize === '14px', css);
css = cellCss({ border: { bottom: { style: 'thick', color: '#333333' } } });
ok('a border keeps its side, weight and colour',
   /3px solid #333333/.test(css.borderBottom), css);
ok('no style is no CSS', cellCss(null) === undefined);

/* ------------------------------------------------------------------- ranges and merges */
console.log('\n# ranges');
ok('a range becomes a rectangle',
   JSON.stringify(parseSqref('B2:D4')) === '[{"r1":1,"c1":1,"r2":3,"c2":3}]', parseSqref('B2:D4'));
ok('and several ranges in one attribute become several',
   parseSqref('A1 C3:D9 F1').length === 3, parseSqref('A1 C3:D9 F1'));
ok('a single cell is a rectangle of one',
   JSON.stringify(parseSqref('A1')) === '[{"r1":0,"c1":0,"r2":0,"c2":0}]');

const merges = readMerges(['A1:C1', 'B3:B5']);
ok('a merge knows how far it reaches',
   merges[0].rows === 1 && merges[0].cols === 3 && merges[1].rows === 3 && merges[1].cols === 1, merges);
const laid = layout([cell(0, 0, 'Title'), cell(2, 1, 'x')], { rows: 6, cols: 4, merges: ['A1:C1'] });
ok('the cells a merge swallows are marked so they are not drawn twice',
   laid.covered.has('0:1') && laid.covered.has('0:2') && !laid.covered.has('0:0'), [...laid.covered.keys()]);
ok('and the one that survives knows its span',
   laid.spans.get('0:0').cols === 3, laid.spans.get('0:0'));

/* --------------------------------------------------------------- conditional formats */
console.log('\n# a rule that paints a cell');
const cells = [cell(1, 13, 3), cell(2, 13, 2), cell(3, 13, 1), cell(4, 13, null, '')];
const rules = prepareRules([{
  sqref: 'N1:N343',
  rules: [
    { type: 'cellIs', priority: 1, operator: 'equal', formulas: ['3'], style: { fill: '#93C47D' } },
    { type: 'cellIs', priority: 2, operator: 'equal', formulas: ['2'], style: { fill: '#FFD966' } },
  ],
}], cells);
ok('the value the rule names is painted', ruleCss(rules, 1, 13, 3).background === '#93C47D', ruleCss(rules, 1, 13, 3));
ok('a different value gets the other colour', ruleCss(rules, 2, 13, 2).background === '#FFD966');
ok('a value no rule names is left alone', ruleCss(rules, 3, 13, 1) === null);
ok('and a cell outside the range is never touched', ruleCss(rules, 1, 4, 3) === null);

const greater = prepareRules([{ sqref: 'B2:B9', rules: [
  { type: 'cellIs', operator: 'greaterThan', formulas: ['500'], style: { fill: '#FF0000' } }] }], []);
ok('greater-than compares as a number', !!ruleCss(greater, 1, 1, 652) && !ruleCss(greater, 1, 1, 300));
ok('and text that is not a number never fires it', !ruleCss(greater, 1, 1, 'Nubi'));

const text = prepareRules([{ sqref: 'A1:A9', rules: [
  { type: 'containsText', text: 'transfer', style: { color: '#999999' } }] }], []);
ok('containsText does not mind case', !!ruleCss(text, 0, 0, 'z1.Transferred'), ruleCss(text, 0, 0, 'z1.Transferred'));

const scale = prepareRules([{ sqref: 'C1:C4', rules: [
  { type: 'colorScale', colors: ['#FFFFFF', '#FF0000'], style: null } ] }],
  [cell(0, 2, 0), cell(1, 2, 50), cell(2, 2, 100)]);
ok('a colour scale puts the low end at one colour and the high at the other',
   ruleCss(scale, 0, 2, 0).background === 'rgb(255, 255, 255)'
   && ruleCss(scale, 2, 2, 100).background === 'rgb(255, 0, 0)',
   [ruleCss(scale, 0, 2, 0), ruleCss(scale, 2, 2, 100)]);
ok('and something in between, in between', ruleCss(scale, 1, 2, 50).background === 'rgb(255, 128, 128)',
   ruleCss(scale, 1, 2, 50));

const expression = prepareRules([{ sqref: 'A1:A9', rules: [
  { type: 'expression', formulas: ['=ISBLANK(A1)'], style: { fill: '#000000' } }] }], []);
ok('a rule needing a formula engine is left alone rather than guessed at',
   ruleCss(expression, 0, 0, '') === null);

/* ------------------------------------------------------------------------ dropdowns */
console.log('\n# a dropdown');
const lists = prepareValidation([
  { type: 'list', sqref: 'E2:E9', formula1: '"698N,698S,698W,698C"' },
  { type: 'list', sqref: 'F2:F9', formula1: 'Options!$A$1:$A$9' },
  { type: 'custom', sqref: 'G2:G9', formula1: 'LEN(G2)<10' },
]);
ok('only the lists become dropdowns', lists.length === 2, lists.length);
ok('a list written into the rule gives its options',
   validationAt(lists, 1, 4).options.join() === '698N,698S,698W,698C', validationAt(lists, 1, 4));
ok('a list pointing at a range says where rather than pretending',
   validationAt(lists, 1, 5).options === null && /Options!/.test(validationAt(lists, 1, 5).from),
   validationAt(lists, 1, 5));
ok('a cell with no dropdown has none', validationAt(lists, 1, 9) === null);

/* ------------------------------------------------------------- the spreadsheet engine */
console.log('\n# there and back through the engine');
const u = toUniverStyle({ bold: true, italic: true, fill: '#00FF00', color: '#FF0000', size: 12,
                          align: 'center', valign: 'top', wrap: true, numFmt: 'yyyy-mm-dd',
                          border: { bottom: { style: 'thin', color: '#333333' } } });
ok('a style goes into the engine\'s own shape',
   u.bl === 1 && u.bg.rgb === '#00FF00' && u.ht === 2 && u.tb === 3 && u.n.pattern === 'yyyy-mm-dd'
   && u.bd.b.s === 1, u);
const back = fromUniverStyle(u);
ok('and comes back as what it was',
   back.bold && back.italic && back.fill === '#00FF00' && back.color === '#FF0000'
   && back.align === 'center' && back.valign === 'top' && back.wrap
   && back.numFmt === 'yyyy-mm-dd' && back.border.bottom.style === 'thin', back);

const sheet = { id: 'sh1', name: 'August 2026', rows: 4, cols: 3, version: 2,
                frozen: { rows: 1, cols: 1 }, defaults: { colWidth: 120, rowHeight: 24 } };
const styles = [{}, { bold: true, fill: '#00FF00' }];
const meta = { merges: ['A1:C1'], cols: [{ min: 0, max: 0, width: 200 }], rows: [{ r: 0, height: 40 }] };
const sheetCells = [
  cell(0, 0, 'August 2026', 'str', 1),
  cell(1, 0, 'Nubi'), cell(1, 1, 652, 'n'), cell(1, 2, null, '', 1),
  cell(2, 0, 'Goose'), cell(2, 1, 540, 'n', 0, 'B2-112'),
];
const book = toUniver({ sheet, styles, meta, cells: sheetCells });
ok('the workbook has one sheet, named after the tab',
   book.sheetOrder.length === 1 && book.sheets.sh.name === 'August 2026', book.sheetOrder);
ok('the cells are where they were', book.sheets.sh.cellData[1][1].v === 652, book.sheets.sh.cellData[1]);
ok('a formula goes in with its equals sign', book.sheets.sh.cellData[2][1].f === '=B2-112');
ok('the merge, the width, the height and the freeze all travel',
   book.sheets.sh.mergeData[0].endColumn === 2 && book.sheets.sh.columnData[0].w === 200
   && book.sheets.sh.rowData[0].h === 40 && book.sheets.sh.freeze.ySplit === 1, book.sheets.sh.freeze);
ok('and the style pool goes with them', book.styles.s1.bl === 1, book.styles);

const out = fromUniver(book, styles);
ok('coming back, every cell is still there', out.cells.length === sheetCells.length, out.cells);
ok('with its value and its type', out.cells.find(c => c[0] === 1 && c[1] === 1)[2] === 652);
ok('its formula, without the equals sign',
   out.cells.find(c => c[0] === 2 && c[1] === 1)[4] === 'B2-112', out.cells.find(c => c[0] === 2 && c[1] === 1));
ok('a painted blank survives the trip',
   !!out.cells.find(c => c[0] === 1 && c[1] === 2 && c[2] === null && c[5] === 1), out.cells);
ok('an untouched cell keeps the very style index it came in with',
   out.cells.find(c => c[0] === 0 && c[1] === 0)[5] === 1);
ok('the pool is not rewritten when nothing new was made', out.styles.length === styles.length, out.styles);
ok('and the merges come back', out.merges.join() === 'A1:C1', out.merges);

// A style made inside the engine must be appended, never substituted: every other tab in the
// file points into this pool by index.
const edited = JSON.parse(JSON.stringify(book));
edited.styles.brandNew = { bl: 1, bg: { rgb: '#FFFF00' } };
edited.sheets.sh.cellData[2][0].s = 'brandNew';
const grown = fromUniver(edited, styles);
ok('a new style is added to the end of the pool',
   grown.styles.length === styles.length + 1 && grown.styles[2].fill === '#FFFF00', grown.styles);
ok('and the old indices still mean what they meant',
   JSON.stringify(grown.styles[1]) === JSON.stringify(styles[1]), grown.styles[1]);
ok('the cell that was restyled points at the new one',
   grown.cells.find(c => c[0] === 2 && c[1] === 0)[5] === 2, grown.cells.find(c => c[0] === 2 && c[1] === 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
