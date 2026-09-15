// The writer's output, read back by the reader this app already had.
global.Blob = (await import('node:buffer')).Blob;
const { toXlsx, toCsv } = await import('../web/src/services/exporter.js');
const { readXlsx } = await import('../web/src/services/xlsx.js');

const columns = [
  { key: 'place', header: 'Rank', type: 'int', width: 70 },
  { key: 'search', header: 'Player', type: 'text', width: 180 },
  { key: 'x:Notes', header: 'Notes, with a comma', type: 'text', width: 200 },
];
const rows = [
  { place: 1, search: 'ŊŲƁĮ', 'x:Notes': 'said "hello"' },
  { place: 2, search: '🐻‍❄️', 'x:Notes': null },
  { place: 3, search: 'A & B <tag>', 'x:Notes': 'line\nbreak' },
];

const blob = await toXlsx(columns, rows, 'Kartz 698W');
const buf = await blob.arrayBuffer();
const out = await readXlsx(buf);
const got = out.sheets[0].rows;
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, JSON.stringify(e)); } };
ok('one sheet, named', out.sheets.length === 1 && out.sheets[0].name === 'Kartz 698W', out.sheets.map(s => s.name));
ok('header row', got[0].join('|') === 'Rank|Player|Notes, with a comma', got[0]);
ok('numbers stay numbers', got[1][0] === 1, got[1]);
ok('stylised unicode survives', got[1][1] === 'ŊŲƁĮ', got[1][1]);
ok('emoji survives', got[2][1] === '🐻‍❄️', got[2][1]);
ok('quotes survive', got[1][2] === 'said "hello"', got[1][2]);
ok('xml-special characters survive', got[3][1] === 'A & B <tag>', got[3][1]);
ok('newline inside a cell survives', got[3][2] === 'line\nbreak', JSON.stringify(got[3][2]));

const csv = toCsv(columns, rows);
ok('csv quotes a comma in a heading', csv.split('\r\n')[0] === '﻿Rank,Player,"Notes, with a comma"', csv.split('\r\n')[0]);
ok('csv quotes an embedded quote', csv.includes('"said ""hello"""'), csv.split('\r\n')[1]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
