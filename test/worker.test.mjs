import fs from 'node:fs';
import { makeDb, readSchema } from './d1.mjs';
import worker from '../worker.js';

const schema = readSchema();
const DB = makeDb(schema);
const env = { DB, ASSETS: null };

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

async function call(method, path, body) {
  const req = new Request('https://x.test/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// ---- seed a board the way the extractor would --------------------------------------------
console.log('\n# extractor save');
let r = await call('POST', '/runs', {
  date: '2026-09-01', alliance: '698W', label: 'Day 1',
  rows: [
    { place: 1, search: 'Nubi', ingame: 'ŊŲƁĮ', alliance: '698W', points: 652 },
    { place: 2, search: 'Goose', ingame: 'GOOSE', alliance: '698S', points: 540 },
    { place: 3, search: null, ingame: 'NewGuy', alliance: null, points: 300 },
  ],
});
ok('runs POST saves 3', r.json.saved === 3, r.json);
const boardId = r.json.board;

console.log('\n# datasets');
r = await call('GET', '/datasets');
ok('lists roster + 1 board', r.json.boards.length === 1 && r.json.roster.rows === 0, r.json);

r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
ok('reads board rows', r.json.rows.length === 3, r.json);
ok('columns are the record', r.json.columns.map(c => c.key).join(',') === 'place,search,ingame,alliance,points', r.json.columns);
const rows = r.json.rows;
let version = r.json.version;
ok('rows carry ids', rows.every(x => typeof x.id === 'string' && x.id), rows);

console.log('\n# ops: edit, add a column, insert, delete');
r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version,
  ops: [
    { op: 'columns', columns: ['Notes'] },
    { op: 'update', id: rows[0].id, values: { points: 700, 'x:Notes': 'checked' } },
    { op: 'insert', id: 's_new1', sort: 4, values: { place: 4, ingame: 'Late', points: 10 } },
    { op: 'delete', id: rows[2].id },
  ],
});
ok('ops applied', r.json.applied === 3 && r.json.rejected.length === 0, r.json);
version = r.json.version;

r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
ok('Notes column exists', r.json.columns.some(c => c.key === 'x:Notes'), r.json.columns);
ok('edit + insert + delete landed', r.json.rows.length === 3
   && r.json.rows[0].points === 700 && r.json.rows[0]['x:Notes'] === 'checked'
   && r.json.rows.some(x => x.ingame === 'Late'), r.json.rows);
ok('version bumped', r.json.version === version, { got: r.json.version, want: version });

console.log('\n# an inserted row keeps the place it was given');
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
ok('rows carry the stored order', r.json.rows.every(x => typeof x.__sort === 'number'), r.json.rows);
const mid = r.json.rows[0].__sort + (r.json.rows[1].__sort - r.json.rows[0].__sort) / 2;
r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version, ops: [{ op: 'insert', id: 's_between', sort: mid, values: { place: 9, ingame: 'Between', points: 1 } }],
});
version = r.json.version;
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
ok('it landed between the two rows it was put between',
   r.json.rows[1].ingame === 'Between', r.json.rows.map(x => x.ingame));
r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`,
  { version, ops: [{ op: 'delete', id: 's_between' }] });
version = r.json.version;

console.log('\n# version safety');
r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`,
  { version: version - 1, ops: [{ op: 'update', id: rows[0].id, values: { points: 1 } }] });
ok('stale save refused with 409', r.status === 409 && r.json.version === version, r.json);

console.log('\n# rejected ops are named, not silently dropped');
r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version,
  ops: [{ op: 'update', id: rows[0].id, values: { points: 'not a number', 'x:Notes': 'still fine' } }],
});
ok('bad number rejected, good field written', r.json.rejected.length === 1
   && r.json.rejected[0].field === 'points', r.json);
version = r.json.version;

console.log('\n# roster');
r = await call('PUT', '/roster/rows', {
  version: 0,
  columns: ['Player', 'Name in video', 'Alliance', 'CP'],
  mapping: { search: 'Player', ingame: 'Name in video', alliance: 'Alliance' },
  rows: [
    { search: 'Nubi', ingame: 'ŊŲƁĮ', alliance: '698W', extra: { CP: '12M' } },
    { search: 'Goose', ingame: 'GOOSE', alliance: '698S', extra: {} },
  ],
});
ok('roster replaced', r.json.saved === 2, r.json);

r = await call('GET', '/datasets/roster');
ok('roster columns keep their own headings',
   r.json.columns.map(c => c.header).join(',') === 'Player,Name in video,Alliance,CP', r.json.columns);
ok('CP came through', r.json.rows[0]['x:CP'] === '12M', r.json.rows);
const rr = r.json.rows; let rv = r.json.version;

r = await call('POST', '/datasets/roster/ops', {
  version: rv,
  ops: [{ op: 'update', id: rr[1].id, values: { search: 'Nubi' } }],
});
ok('duplicate player name refused', r.json.rejected.length === 1
   && /already another row/.test(r.json.rejected[0].reason), r.json);
rv = r.json.version;

r = await call('POST', '/datasets/roster/ops', {
  version: rv,
  ops: [{ op: 'columns', columns: ['Player', 'Name in video', 'Alliance', 'Combat power'],
          rename: { from: 'CP', to: 'Combat power' } }],
});
ok('column renamed', r.status === 200, r.json);
rv = r.json.version;
r = await call('GET', '/datasets/roster');
ok('rename kept the heading list', r.json.columns.some(c => c.header === 'Combat power'), r.json.columns);

console.log('\n# roster mirror route the extractor uses');
r = await call('GET', '/roster/rows');
ok('mirror has rows + mapping', r.json.rows.length === 2 && r.json.mapping.search === 'Player', r.json);

console.log('\n# extract → data commit');
r = await call('POST', '/commit', {
  mode: 'preview', date: '2026-09-01', alliance: '698W', label: 'Day 1',
  rows: [
    { place: 1, search: 'Nubi', ingame: 'ŊŲƁĮ', points: 900 },
    { place: 5, search: null, ingame: 'Brand New', points: 120 },
  ],
});
ok('preview counts duplicates', r.json.total === 2 && r.json.duplicates === 1 && r.json.new === 1, r.json);

r = await call('POST', '/commit', {
  mode: 'new', date: '2026-09-01', alliance: '698W', label: 'Day 1',
  rows: [
    { place: 1, search: 'Nubi', ingame: 'ŊŲƁĮ', points: 900 },
    { place: 5, search: null, ingame: 'Brand New', points: 120 },
  ],
});
ok('new-only adds one row', r.json.added === 1, r.json);
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
const nubi = r.json.rows.find(x => x.search === 'Nubi');
ok('the hand-edited row was not overwritten', nubi && nubi.points === 700, r.json.rows);
ok('the other field of a part-rejected op was written', nubi && nubi['x:Notes'] === 'still fine', r.json.rows);

r = await call('GET', '/runs');
ok('an extraction run was recorded', r.json.runs.length === 1 && r.json.runs[0].added === 1, r.json);

console.log('\n# activity');
r = await call('GET', '/activity');
ok('activity has entries', r.json.activity.length >= 2, r.json.activity.map(a => a.summary));

console.log('\n# views across boards');
r = await call('GET', '/month?month=2026-09');
ok('month view returns rows', r.json.rows.length >= 3, r.json.rows.length);
r = await call('GET', '/player?search=Nubi');
ok('player history', r.json.history.length === 1, r.json);
r = await call('GET', '/all');
ok('all rows', r.json.rows.length >= 3, r.json.rows.length);

console.log('\n# saved views');
r = await call('POST', '/views', { name: 'Top scorers', dataset: 'board:' + boardId, spec: { sort: { key: 'points' } } });
ok('view saved', !!r.json.id, r.json);
r = await call('GET', '/views?dataset=' + encodeURIComponent('board:' + boardId));
ok('view listed', r.json.views.length === 1, r.json);

console.log('\n# legacy routes still answer');
r = await call('GET', '/boards');
ok('/boards', r.json.boards.length === 1, r.json);
r = await call('GET', '/board?id=' + encodeURIComponent(boardId));
ok('/board?id=', r.json.rows.length === 4, r.json);
r = await call('PATCH', '/score', { board: boardId, place: 2, points: 555 });
ok('/score PATCH', r.json.updated.points === 555, r.json);

console.log('\n# AI status without a provider');
r = await call('GET', '/ai/status');
ok('ai degrades gracefully', r.json.available === false && !!r.json.reason, r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
