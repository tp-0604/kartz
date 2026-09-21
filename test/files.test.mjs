// Folders, files, sheets and the grid, through the real Worker routes.
//
// The grid is written the way the browser writes it — gzipped bands of cells, base64 on the
// wire — so what this exercises is what an import actually does.
import { gzipSync, gunzipSync, strToU8, strFromU8 } from '../web/node_modules/fflate/esm/browser.js';
import { makeDb, readSchema } from './d1.mjs';
import worker from '../worker.js';

const DB = makeDb(readSchema());

// A stand-in for R2: what the bucket keeps, and what it hands back.
const bucket = new Map();
const FILES = {
  async put(key, body, opts) { bucket.set(key, { body: new Uint8Array(body), meta: opts && opts.httpMetadata }); },
  async get(key) {
    const o = bucket.get(key);
    return o ? { body: o.body, size: o.body.length, httpMetadata: o.meta } : null;
  },
};
const env = { DB, FILES, ASSETS: null, ADMIN_CODE: 'code' };

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

let SESSION = null;
async function call(method, path, body, session = SESSION, raw = false) {
  const req = new Request('https://x.test/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
               ...(session ? { 'x-kartz-session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  if (raw) return res;
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const b64 = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = s => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const packBand = cells => b64(gzipSync(strToU8(JSON.stringify(cells))));
const unpackBand = s => JSON.parse(strFromU8(gunzipSync(fromB64(s))));

/* ------------------------------------------------------------------ two accounts to act as */
console.log('\n# accounts');
let r = await call('POST', '/auth/signup', { name: 'Tess', password: 'tess-pass', admin: true, adminCode: 'code' }, null);
SESSION = r.json.token;
ok('an admin to import with', r.json.user.role === 'admin', r.json);
r = await call('POST', '/auth/signup', { name: 'Amy', password: 'amy-pass' }, null);
const AMY = r.json.token;
ok('and a member to try things with', r.json.user.role === 'member', r.json);

/* ------------------------------------------------------------------------------ the tree */
console.log('\n# folders');
r = await call('POST', '/folders', { name: 'TW 2698' });
const root = r.json.folder.id;
ok('a folder is made', r.status === 200 && !!root, r.json);
r = await call('POST', '/folders', { name: 'Seal Stone 2026', parentId: root });
const seal = r.json.folder.id;
ok('and one inside it', r.json.folder.parent_id === root, r.json);
r = await call('POST', '/folders', { name: 'Nowhere', parentId: 'fd_nothing' });
ok('a folder cannot hang off one that does not exist', r.status === 400, r.json);
r = await call('POST', '/folders', { name: '   ' });
ok('and it needs a name', r.status === 400, r.json);

/* --------------------------------------------------------------------------- a workbook */
console.log('\n# a workbook, written the way an import writes one');
r = await call('POST', '/files', { name: 'Calendar', folderId: root, source: 'xlsx',
                                   sourceName: 'Calendar.xlsx' });
const file = r.json.file.id;
ok('an import starts a file', r.status === 200 && r.json.file.ready === false, r.json);

r = await call('GET', '/tree');
ok('which is not in the tree until it is finished',
   !(r.json.files || []).some(f => f.id === file), r.json.files);

r = await call('PUT', `/files/${file}/styles`, { styles: [
  {}, { bold: true, fill: '#00FF00', align: 'center' }, { numFmt: 'yyyy-mm-dd' }] });
ok('its styles are pooled once for the whole file', r.json.styles === 3, r.json);

r = await call('POST', `/files/${file}/sheets`, {
  name: 'August 2026', idx: 0, shape: 'layout', rows: 9, cols: 10,
  frozen: { rows: 1, cols: 0 }, tabColor: '#4472C4' });
const sheet = r.json.sheet.id;
ok('a tab is added', r.status === 200 && !!sheet, r.json);

const cells = [
  [0, 0, 'August Silo/Ruin Calendar', 'str', null, 1],
  [1, 1, 'Su', 'str', null, 1], [1, 2, 'Mo', 'str', null, 1],
  [2, 7, 1, 'n', null, 0],
  [3, 1, 2, 'n', null, 0], [3, 8, 'Silos (1st-N)', 'str', null, 1],
  [4, 9, 'Ruin Swap', 'str', null, 1],
  [5, 0, null, '', null, 1],
];
r = await call('PUT', `/sheets/${sheet}/slab`, { band: 0, count: cells.length, cells: packBand(cells) });
ok('a band of the grid is written', r.status === 200 && r.json.count === 8, r.json);

r = await call('PUT', `/sheets/${sheet}/meta`, { kind: 'merges', json: ['A1:J1', 'I3:J3'] });
ok('and what is drawn around it', r.status === 200, r.json);
await call('PUT', `/sheets/${sheet}/meta`, { kind: 'cols', json: [{ min: 0, max: 0, width: 140 }] });
r = await call('PUT', `/sheets/${sheet}/meta`, { kind: 'nonsense', json: [] });
ok('but only the kinds it keeps', r.status === 400, r.json);

r = await call('POST', `/files/${file}/done`, { report: { google: 0, formulas: 0, notes: ['nothing lost'] } });
ok('finishing counts what landed', r.json.sheets === 1 && r.json.cells === 8, r.json);

/* ------------------------------------------------------------------------- reading it back */
console.log('\n# reading it back');
r = await call('GET', '/tree');
const listed = (r.json.files || []).find(f => f.id === file);
ok('now it is in the tree, with its folder and who added it',
   listed && listed.folder_id === root && listed.owner === 'Tess' && listed.cells === 8, listed);
ok('and the folders come with it', (r.json.folders || []).length === 2, r.json.folders);

r = await call('GET', '/files/' + file);
ok('the file knows its tabs without sending a cell',
   r.json.sheets.length === 1 && r.json.sheets[0].name === 'August 2026'
   && r.json.sheets[0].shape === 'layout' && r.json.sheets[0].cells === 8, r.json.sheets);
ok('the tab keeps its frozen rows and its colour',
   r.json.sheets[0].frozen.rows === 1 && r.json.sheets[0].tabColor === '#4472C4', r.json.sheets[0]);
ok('the styles come back as a pool, indexed the way the cells point at them',
   r.json.styles.length === 3 && r.json.styles[1].fill === '#00FF00', r.json.styles);
ok('the report is kept with the file', r.json.file.report.notes[0] === 'nothing lost', r.json.file.report);

r = await call('GET', `/sheets/${sheet}/cells?from=0&to=100`);
const back = unpackBand(r.json.bands[0].cells);
ok('the grid comes back exactly as it went in',
   JSON.stringify(back) === JSON.stringify(cells), back.slice(0, 2));
ok('including the painted cell with nothing in it',
   back[7][2] === null && back[7][5] === 1, back[7]);

r = await call('GET', `/sheets/${sheet}/meta`);
ok('and the merges', r.json.meta.merges.join() === 'A1:J1,I3:J3', r.json.meta);

r = await call('GET', `/sheets/${sheet}/cells?from=0&to=99999`);
ok('asking for the whole of a huge sheet at once is refused', r.status === 400, r.json);

/* --------------------------------------------------------------------------------- bands */
console.log('\n# a tab too big for one band');
r = await call('POST', `/files/${file}/sheets`, { name: 'Data', idx: 1, shape: 'table', rows: 1200, cols: 4 });
const big = r.json.sheet.id;
for (const band of [0, 1, 2]) {
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push([band * 500 + i, 0, 'row ' + (band * 500 + i), 'str', null, 0]);
  await call('PUT', `/sheets/${big}/slab`, { band, count: rows.length, cells: packBand(rows) });
}
r = await call('GET', '/files/' + file);
const bigSheet = r.json.sheets.find(s => s.id === big);
ok('three bands, counted as one tab', bigSheet.cells === 1500 && bigSheet.bands === 3, bigSheet);
r = await call('GET', `/sheets/${big}/cells?from=500&to=999`);
ok('and the middle one can be read on its own',
   r.json.bands.length === 1 && r.json.bands[0].band === 1
   && unpackBand(r.json.bands[0].cells)[0][0] === 500, r.json.bands.map(b => b.band));
r = await call('GET', `/sheets/${big}/cells?from=0&to=1199`);
ok('or all three together', r.json.bands.map(b => b.band).join() === '0,1,2', r.json.bands.length);

/* ------------------------------------------------------------- the part that is a table */
console.log('\n# the projection: the part of a sheet you can ask about');
r = await call('POST', `/files/${file}/sheets`, { name: 'Form Responses', idx: 2, shape: 'table', rows: 4, cols: 3 });
const tsheet = r.json.sheet.id;
r = await call('PUT', `/sheets/${tsheet}/table`, {
  name: 'Form Responses', headerRow: 0, firstRow: 1, lastRow: 3, firstCol: 0, lastCol: 2,
  columns: [{ col: 0, header: 'Name' }, { col: 1, header: 'Alliance' }, { col: 2, header: 'CP' }],
  rows: [
    { idx: 0, r: 1, data: { Name: 'Nubi', Alliance: '698W', CP: 101 } },
    { idx: 1, r: 2, data: { Name: 'Cein', Alliance: '698N', CP: 94 } },
    { idx: 2, r: 3, data: { Name: 'Amcia', Alliance: '698C', CP: 87 } },
  ],
});
ok('a sheet gets a projection', r.status === 200 && r.json.rows === 3 && r.json.columns === 3, r.json);

r = await call('GET', `/sheets/${tsheet}/tables`);
ok('which the sheet knows about', r.json.tables.length === 1
   && r.json.tables[0].columns.map(c => c.header).join() === 'Name,Alliance,CP', r.json.tables);
const tableId = r.json.tables[0].id;

r = await call('GET', '/tables?limit=10');
const listed2 = r.json.tables.find(t => t.id === tableId);
ok('and so does the catalogue, with the file it came from',
   listed2 && listed2.file === 'Calendar' && listed2.sheet === 'Form Responses', listed2);
r = await call('GET', '/tables?q=alliance');
ok('the catalogue can be searched by the columns a table has',
   (r.json.tables || []).some(t => t.id === tableId), r.json.tables && r.json.tables.length);

r = await call('POST', `/tables/${tableId}/query`, { filters: [{ field: 'Alliance', op: 'eq', value: '698N' }] });
ok('a filter runs over the JSON, whatever the columns are',
   r.json.matched === 1 && r.json.rows[0].Name === 'Cein', r.json);
r = await call('POST', `/tables/${tableId}/query`, { filters: [{ field: 'CP', op: 'gte', value: 90 }], sort: 'CP', desc: true });
ok('numbers compare as numbers', r.json.matched === 2 && r.json.rows[0].CP === 101, r.json.rows);
r = await call('POST', `/tables/${tableId}/query`, { filters: [{ field: 'Name', op: 'contains', value: 'ei' }] });
ok('and text contains as text', r.json.matched === 1 && r.json.rows[0].Name === 'Cein', r.json.rows);
r = await call('GET', `/tables/${tableId}?limit=2`);
ok('rows come back a page at a time', r.json.rows.length === 2 && r.json.table.rows === 3, r.json.table);

r = await call('PUT', `/sheets/${tsheet}/table`, {
  name: 'Form Responses', headerRow: 0, firstRow: 1, lastRow: 2, firstCol: 0, lastCol: 2,
  columns: [{ col: 0, header: 'Name' }], rows: [{ idx: 0, r: 1, data: { Name: 'Nubi' } }],
});
r = await call('GET', `/sheets/${tsheet}/tables`);
ok('re-projecting replaces what was there rather than doubling it',
   r.json.tables.length === 1 && r.json.tables[0].rows === 1, r.json.tables);

/* -------------------------------------------------------------------- editing a band */
console.log('\n# an edit, and two people editing at once');
let read = await call('GET', '/files/' + file);
const v = read.json.sheets.find(s => s.id === sheet).version;
r = await call('PUT', `/sheets/${sheet}/slab`,
  { band: 0, count: 1, cells: packBand([[0, 0, 'Edited', 'str', null, 1]]), version: v,
    summary: 'changed A1 on August 2026' });
ok('an edit against the version it was made on is written',
   r.status === 200 && r.json.version === v + 1, r.json);
r = await call('PUT', `/sheets/${sheet}/slab`,
  { band: 0, count: 1, cells: packBand([[0, 0, 'Clobber', 'str', null, 1]]), version: v });
ok('and one made against an older copy is refused rather than landing on top',
   r.status === 409 && /somebody else changed/.test(r.json.error.message), r.json);
r = await call('GET', '/activity?limit=5');
ok('what the edit was is in the log',
   (r.json.activity || []).some(a => /changed A1 on August 2026/.test(a.summary || '')), r.json.activity);

/* ------------------------------------------------------------------------------ pictures */
console.log('\n# the pictures that came with the sheet');
const hash = 'a'.repeat(40);
r = await call('POST', '/assets/have', { ids: [hash] });
ok('an import asks first, and is told nothing is there yet', r.json.have.length === 0, r.json);

let res = await worker.fetch(new Request('https://x.test/api/assets/' + hash, {
  method: 'PUT', headers: { 'content-type': 'image/png', 'Sec-Fetch-Site': 'same-origin',
                            'x-kartz-session': SESSION },
  body: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }), env);
ok('a picture goes to the bucket', res.status === 200 && bucket.has(hash), await res.clone().json());

r = await call('POST', '/assets/have', { ids: [hash, 'b'.repeat(40)] });
ok('and the second time round it is skipped', r.json.have.join() === hash, r.json);

res = await worker.fetch(new Request('https://x.test/api/assets/' + hash, {
  headers: { Origin: 'https://tp-0604.github.io', 'x-kartz-session': SESSION } }), env);
ok('it comes back as a picture, not as JSON',
   res.status === 200 && res.headers.get('content-type') === 'image/png'
   && /immutable/.test(res.headers.get('cache-control') || ''), res.status);
ok('and the page on GitHub Pages is allowed to draw it',
   res.headers.get('access-control-allow-origin') === 'https://tp-0604.github.io',
   res.headers.get('access-control-allow-origin'));

res = await call('GET', '/assets/' + 'c'.repeat(40), undefined, SESSION, true);
ok('a picture that was never there says so', res.status === 404, res.status);

/* --------------------------------------------------------------------------- who may write */
console.log('\n# who may write to a file');
r = await call('PUT', `/sheets/${sheet}/slab`, { band: 0, count: 1, cells: packBand([[0, 0, 'x', 'str', null, 0]]) }, AMY);
ok("a member cannot write over somebody else's file", r.status === 403, r.json);
r = await call('PATCH', '/files/' + file, { name: 'Renamed' }, AMY);
ok('nor rename it', r.status === 403, r.json);
r = await call('DELETE', '/files/' + file, undefined, AMY);
ok('nor delete it', r.status === 403, r.json);
r = await call('POST', '/files', { name: 'Amy notes', folderId: root }, AMY);
const amyFile = r.json.file.id;
ok('but she can make her own', r.status === 200 && r.json.file.ready === true, r.json);
r = await call('POST', `/files/${amyFile}/sheets`, { name: 'Sheet1' }, AMY);
ok('and put a sheet in it', r.status === 200, r.json);
r = await call('POST', '/files', { name: 'Big import', source: 'xlsx' }, AMY);
ok('a whole workbook import is still an admin thing', r.status === 403, r.json);
r = await call('DELETE', '/files/' + amyFile, undefined, AMY);
ok('she can delete what she made', r.status === 200, r.json);
r = await call('GET', '/tree', undefined, null);
ok('and signed out, none of it answers', r.status === 401, r.status);

/* -------------------------------------------------------------------------------- tidying */
console.log('\n# deleting');
r = await call('DELETE', '/folders/' + root);
ok('a folder with files in it is not deleted by accident', r.status === 400 && /still holds/.test(r.json.error.message), r.json);
r = await call('DELETE', '/files/' + file);
ok('the file goes, and its sheets with it', r.status === 200 && r.json.sheets === 3, r.json);
const left = DB._raw.prepare(
  `SELECT (SELECT COUNT(*) FROM slabs) AS slabs, (SELECT COUNT(*) FROM sheet_meta) AS meta,
          (SELECT COUNT(*) FROM styles) AS styles, (SELECT COUNT(*) FROM tables) AS tables,
          (SELECT COUNT(*) FROM table_rows) AS rows`).get();
ok('and nothing of it is left behind — slabs, styles, meta and the projection',
   left.slabs === 0 && left.meta === 0 && left.styles === 0 && left.tables === 0 && left.rows === 0, left);
r = await call('DELETE', '/folders/' + seal);
ok('an empty folder goes', r.status === 200, r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
