// Reading a whole .xlsx — values, formulas, and everything drawn around them.
//
// The workbook here is built in memory, one zip with the parts a real Google export has, so the
// test needs no file on disk and says exactly which part of the reader each check is about.
import { zipSync, strToU8 } from '../web/node_modules/fflate/esm/browser.js';
import { readBook, shiftFormula, readDummy, colName, colIndex, isDateFormat } from '../web/src/services/xlsxBook.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

/* ---------------------------------------------------------------- column letters and refs */
console.log('\n# the alphabet spreadsheets count in');
ok('A is 0 and BC is 54', colIndex('A') === 0 && colIndex('BC') === 54);
ok('and back again', colName(0) === 'A' && colName(54) === 'BC' && colName(26) === 'AA');
ok('a date format is recognised by its letters', isDateFormat('yyyy-mm-dd') && isDateFormat('m/d/yy h:mm'));
ok('and a number format is not', !isDateFormat('#,##0.00') && !isDateFormat('General')
   && !isDateFormat('0.0%'), 'percent has no d m or y');

/* ------------------------------------------------------------------- moving a formula */
console.log('\n# a shared formula moved to where it is used');
ok('relative references follow the cell',
   shiftFormula('A1+B2', 2, 1) === 'B3+C4', shiftFormula('A1+B2', 2, 1));
ok('absolute ones stay where they are',
   shiftFormula('$A$1+A1', 3, 0) === '$A$1+A4', shiftFormula('$A$1+A1', 3, 0));
ok('a half-absolute reference moves only the free half',
   shiftFormula('$A1+A$1', 2, 2) === '$A3+C$1', shiftFormula('$A1+A$1', 2, 2));
ok('a function is not a column',
   shiftFormula('LOG10(A1)+SUM(B1:B2)', 1, 0) === 'LOG10(A2)+SUM(B2:B3)',
   shiftFormula('LOG10(A1)+SUM(B1:B2)', 1, 0));
ok('a string is left exactly as written',
   shiftFormula('IF(A1>1,"A1 is big","")', 1, 0) === 'IF(A2>1,"A1 is big","")',
   shiftFormula('IF(A1>1,"A1 is big","")', 1, 0));
ok('a quoted sheet name is not a reference',
   shiftFormula("VLOOKUP($B2,'Input-Roster'!$A:$I,4,false)", 5, 0)
     === "VLOOKUP($B7,'Input-Roster'!$A:$I,4,false)",
   shiftFormula("VLOOKUP($B2,'Input-Roster'!$A:$I,4,false)", 5, 0));
ok('a column-only range is left alone',
   shiftFormula('COUNTIF($B:$B,$B2)>1', 3, 0) === 'COUNTIF($B:$B,$B5)>1',
   shiftFormula('COUNTIF($B:$B,$B5)>1', 0, 0));
ok('moving off the sheet says so rather than inventing a cell',
   shiftFormula('A1', -5, 0) === '#REF!', shiftFormula('A1', -5, 0));
ok('a formula that does not move comes back untouched',
   shiftFormula('SUM(A1:A9)', 0, 0) === 'SUM(A1:A9)');

console.log('\n# a Sheets-only function, as Google exports it');
let d = readDummy('IFERROR(__xludf.DUMMYFUNCTION("IMPORTRANGE(""https://x/y"", ""A!A:I"")"),"Search Name")');
ok('the original formula is lifted back out',
   d && d.google === 'IMPORTRANGE("https://x/y", "A!A:I")', d);
d = readDummy('IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Alliance")');
ok('and when Google kept none of it, that is said plainly', d && d.google === null, d);
ok('an ordinary formula is not mistaken for one', readDummy('SUM(A1:A9)') === null);

/* ----------------------------------------------------------------- a whole workbook */
const XL = {};
const put = (p, s) => { XL[p] = strToU8(s); };

put('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
put('_rels/.rels', '<?xml version="1.0"?><Relationships/>');
put('xl/workbook.xml',
  '<?xml version="1.0"?><workbook><sheets>' +
  '<sheet name="Scores" sheetId="1" r:id="rId1"/>' +
  '<sheet name="Map" sheetId="2" r:id="rId2"/>' +
  '<sheet name="Old" sheetId="3" state="hidden" r:id="rId3"/>' +
  '</sheets><definedNames><definedName name="Roster">Scores!$A$1:$C$9</definedName></definedNames></workbook>');
put('xl/_rels/workbook.xml.rels',
  '<?xml version="1.0"?><Relationships>' +
  '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
  '<Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>');
put('xl/sharedStrings.xml',
  '<?xml version="1.0"?><sst><si><t>Game Name</t></si><si><t>&#55356;&#57119;N&#360;&#372;I</t></si>' +
  '<si><r><t>two </t></r><r><t>runs</t></r></si></sst>');
put('xl/theme/theme1.xml',
  '<a:theme><a:themeElements><a:clrScheme><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
  '</a:clrScheme></a:themeElements></a:theme>');
put('xl/styles.xml',
  '<?xml version="1.0"?><styleSheet>' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font>' +
  '<font><b/><sz val="12"/><color rgb="FFFF0000"/><name val="Sora"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/><bgColor rgb="FF000000"/></patternFill></fill></fills>' +
  '<borders count="2"><border/><border><bottom style="thin"><color rgb="FF333333"/></bottom></border></borders>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +                                    // 0 plain
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" wrapText="1"/></xf>' + // 1 the lot
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>' +            // 2 a date
  '<xf numFmtId="0" fontId="0" fillId="2" borderId="0"/>' +                                    // 3 a fill only
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +                                    // 4 nothing
  '</cellXfs>' +
  '<dxfs count="1"><dxf><fill><patternFill><bgColor rgb="FFFFFF00"/></patternFill></fill></dxf></dxfs>' +
  '</styleSheet>');

put('xl/worksheets/sheet1.xml',
  '<?xml version="1.0"?><worksheet>' +
  '<sheetPr><tabColor rgb="FF4472C4"/></sheetPr>' +
  '<dimension ref="A1:F9"/>' +
  '<sheetViews><sheetView><pane xSplit="1" ySplit="2" topLeftCell="B3" state="frozen"/></sheetView></sheetViews>' +
  '<sheetFormatPr defaultRowHeight="15"/>' +
  '<cols><col min="1" max="1" width="24" customWidth="1"/><col min="4" max="4" hidden="1"/></cols>' +
  '<sheetData>' +
  '<row r="1" ht="30" customHeight="1">' +
    '<c r="A1" s="1" t="s"><v>0</v></c>' +
    '<c r="B1" s="1" t="s"><v>1</v></c>' +
    '<c r="C1" s="1" t="s"><v>2</v></c>' +
  '</row>' +
  '<row r="2">' +
    '<c r="A2" t="s"><v>1</v></c>' +
    '<c r="B2"><v>652</v></c>' +
    '<c r="C2" s="2"><v>46100</v></c>' +
    '<c r="D2"><f t="shared" ref="D2:D4" si="0">B2*2</f><v>1304</v></c>' +
    '<c r="E2" t="b"><v>1</v></c>' +
  '</row>' +
  '<row r="3">' +
    '<c r="B3"><v>540</v></c>' +
    '<c r="D3"><f t="shared" si="0"/><v>1080</v></c>' +
    '<c r="E3" t="e"><v>#N/A</v></c>' +
  '</row>' +
  '<row r="4">' +
    '<c r="B4"><v>300</v></c>' +
    '<c r="D4"><f t="shared" si="0"/><v>600</v></c>' +
    '<c r="F4" t="str"><f>IFERROR(__xludf.DUMMYFUNCTION("QUERY(A:B,&quot;&quot;&quot;&quot;select A&quot;&quot;&quot;&quot;)"),"Nubi")</f><v>Nubi</v></c>' +
  '</row>' +
  '<row r="5">' +
    '<c r="A5" s="3"/>' +                                  // painted, empty: kept
    '<c r="B5" s="4"/>' +                                  // padding: dropped
    '<c r="C5"/>' +                                        // nothing at all: dropped
  '</row>' +
  '</sheetData>' +
  '<autoFilter ref="A1:F9"/>' +
  '<mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells>' +
  '<conditionalFormatting sqref="B2:B9"><cfRule type="cellIs" operator="greaterThan" priority="1" dxfId="0">' +
  '<formula>500</formula></cfRule></conditionalFormatting>' +
  '<dataValidations count="1"><dataValidation type="list" sqref="E2:E9" allowBlank="1">' +
  '<formula1>"698N,698S,698W,698C"</formula1></dataValidation></dataValidations>' +
  '<hyperlinks><hyperlink ref="A1" r:id="rH1"/></hyperlinks>' +
  '</worksheet>');
put('xl/worksheets/_rels/sheet1.xml.rels',
  '<?xml version="1.0"?><Relationships><Relationship Id="rH1" Target="https://example.test/roster"/></Relationships>');
put('xl/worksheets/sheet2.xml',
  '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" s="1" t="s"><v>0</v></c></row></sheetData></worksheet>');
put('xl/worksheets/sheet3.xml',
  '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>');

const bytes = zipSync(XL);
const book = await readBook(bytes);
const s = book.sheets[0];
const cell = (r, c) => s.cells.find(x => x[0] === r && x[1] === c);
const style = c => book.styles[c[5]] || {};

console.log('\n# the workbook, its tabs and its strings');
ok('three tabs, in order, with the hidden one marked',
   book.sheets.map(x => x.name).join() === 'Scores,Map,Old' && book.sheets[2].hidden === true,
   book.sheets.map(x => [x.name, x.hidden]));
ok('a shared string comes back as text', cell(0, 0)[2] === 'Game Name', cell(0, 0));
ok('an in-game name survives its numeric entities, surrogate pair and all',
   cell(1, 0)[2] === '\u{1F31F}N\u0168\u0174I', cell(1, 0)[2]);
ok('a string written in runs is joined', cell(0, 2)[2] === 'two runs', cell(0, 2)[2]);
ok('a defined name is kept', book.definedNames[0].name === 'Roster', book.definedNames);

console.log('\n# values keep their type');
ok('a number is a number', cell(1, 1)[2] === 652 && cell(1, 1)[3] === 'n', cell(1, 1));
ok('a boolean is a boolean', cell(1, 4)[2] === true, cell(1, 4));
ok('an error stays an error rather than becoming text',
   cell(2, 4)[2] === '#N/A' && cell(2, 4)[3] === 'e' && book.report.errors === 1, cell(2, 4));
ok('a date keeps its serial and its format',
   cell(1, 2)[2] === 46100 && style(cell(1, 2)).numFmt === 'yyyy-mm-dd'
   && isDateFormat(style(cell(1, 2)).numFmt), style(cell(1, 2)));

console.log('\n# formulas');
ok('the master of a shared formula keeps its text', cell(1, 3)[4] === 'B2*2', cell(1, 3));
ok('and its followers are shifted to where they sit',
   cell(2, 3)[4] === 'B3*2' && cell(3, 3)[4] === 'B4*2', [cell(2, 3), cell(3, 3)]);
ok('a follower keeps the value the file computed', cell(2, 3)[2] === 1080, cell(2, 3));
ok('three formulas, counted', book.report.formulas === 3, book.report);
const g = cell(3, 5);
ok('a Sheets-only function keeps its value and loses its wrapper',
   g[2] === 'Nubi' && g[4] === null, g);
ok('and the Google formula is kept as a note',
   g[6] === 'google:QUERY(A:B,""select A"")' && book.report.google === 1, g[6]);

console.log('\n# what is drawn around the values');
ok('bold, size, colour and face come off the font',
   style(cell(0, 0)).bold === true && style(cell(0, 0)).size === 12
   && style(cell(0, 0)).color === '#FF0000' && style(cell(0, 0)).name === 'Sora', style(cell(0, 0)));
ok('a solid fill takes its colour from the foreground, as the format means it',
   style(cell(0, 0)).fill === '#00FF00', style(cell(0, 0)));
ok('a border keeps its side, style and colour',
   style(cell(0, 0)).border.bottom.style === 'thin'
   && style(cell(0, 0)).border.bottom.color === '#333333', style(cell(0, 0)).border);
ok('alignment and wrapping come across',
   style(cell(0, 0)).align === 'center' && style(cell(0, 0)).wrap === true, style(cell(0, 0)));
ok('a merged range is kept', s.merges.join() === 'A1:C1', s.merges);
ok('a frozen pane knows how much is frozen',
   s.frozen && s.frozen.rows === 2 && s.frozen.cols === 1, s.frozen);
ok('a custom column width is kept, and a hidden column is marked',
   s.cols.length === 2 && s.cols[0].width > 0 && s.cols[1].hidden === true, s.cols);
ok('a custom row height is kept', s.rows.length === 1 && s.rows[0].r === 0 && s.rows[0].height > 0, s.rows);
ok('the tab colour is read', s.tabColor === '#4472C4', s.tabColor);
ok('the filter range is kept', s.autoFilter === 'A1:F9', s.autoFilter);

console.log('\n# behaviour');
ok('a dropdown keeps its list and where it applies',
   s.validations.length === 1 && s.validations[0].type === 'list'
   && s.validations[0].sqref === 'E2:E9'
   && s.validations[0].formula1 === '"698N,698S,698W,698C"', s.validations);
ok('a conditional rule keeps its test and the format it paints',
   s.condFmts.length === 1 && s.condFmts[0].rules[0].operator === 'greaterThan'
   && s.condFmts[0].rules[0].formulas[0] === '500'
   && s.condFmts[0].rules[0].style.fill === '#FFFF00', s.condFmts[0]);
ok('a hyperlink keeps its target',
   s.hyperlinks.length === 1 && s.hyperlinks[0].url === 'https://example.test/roster', s.hyperlinks);

console.log('\n# what is not worth keeping');
ok('a painted but empty cell is kept, because that is the drawing',
   !!cell(4, 0) && cell(4, 0)[2] === null && style(cell(4, 0)).fill === '#00FF00', cell(4, 0));
ok('a cell whose style paints nothing is dropped, however it is styled', !cell(4, 1) && !cell(4, 2),
   [cell(4, 1), cell(4, 2)]);

console.log('\n# reading only the tabs that are wanted');
const part = await readBook(bytes, { want: name => name === 'Map' });
ok('the rest are listed but never decompressed',
   part.sheets[0].skipped === true && part.sheets[1].cells.length === 1
   && part.report.skipped.join() === 'Scores,Old', part.report.skipped);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
