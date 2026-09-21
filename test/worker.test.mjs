import fs from 'node:fs';
import { makeDb, readSchema } from './d1.mjs';
import worker from '../worker.js';
import { summarizeSessions } from '../worker/summaries.js';

const schema = readSchema();
const DB = makeDb(schema);
const env = { DB, ASSETS: null, ADMIN_CODE: 'test-admin-code', OWNER_CODE: 'test-owner-code' };
let SESSION = null;          // the admin's, once signed up; each call sends it unless told otherwise

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

async function call(method, path, body, session = SESSION) {
  const req = new Request('https://x.test/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
               ...(session ? { 'x-kartz-session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// ---- an account first: nothing else answers without one -----------------------------------
console.log('\n# accounts');
let acct = await call('GET', '/boards');
ok('signed out, the data routes refuse', acct.status === 401, acct);
acct = await call('POST', '/auth/signup', { name: 'Tahp', password: 'secret-1', admin: true, adminCode: 'test-admin-code' });
ok('an admin signs up with the admin code', acct.status === 200 && acct.json.user.role === 'admin' && !!acct.json.token, acct.json);
SESSION = acct.json.token;

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

console.log('\n# marking cells up');
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
const mark = r.json.rows[0];
const markedBefore = mark.edited;          // this row was corrected earlier in the run
version = r.json.version;
r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version,
  ops: [{ op: 'update', id: mark.id, style: { points: { bg: 'yellow', b: 1 }, __row: { fg: 'red' } } }],
});
ok('a style op is accepted', r.json.rejected.length === 0, r.json);
version = r.json.version;
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
const marked = r.json.rows.find(x => x.id === mark.id);
ok('the fill comes back', marked.__style.points.bg === 'yellow' && marked.__style.points.b === 1, marked.__style);
ok('a whole-row mark comes back', marked.__style.__row.fg === 'red', marked.__style);
ok('marking a cell is not correcting it', marked.edited === markedBefore,
   { before: markedBefore, after: marked.edited });

r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version,
  ops: [{ op: 'update', id: mark.id, style: { points: { bg: '#ff0000', fg: 'chartreuse', b: 1 } } }],
});
version = r.json.version;
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
const after2 = r.json.rows.find(x => x.id === mark.id);
ok('a colour it was not offered is refused, the rest kept',
   after2.__style.points.b === 1 && !after2.__style.points.bg && !after2.__style.points.fg,
   after2.__style);

r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version, ops: [{ op: 'update', id: mark.id, style: { nosuchcolumn: { bg: 'red' } } }] });
ok('a mark on a column that does not exist is refused', r.json.rejected.length === 1
   && r.json.rejected[0].field === 'nosuchcolumn', r.json.rejected);
version = r.json.version;

r = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`, {
  version, ops: [{ op: 'update', id: mark.id, style: { points: null, __row: null } }] });
version = r.json.version;
r = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
ok('clearing removes the bag entirely',
   !r.json.rows.find(x => x.id === mark.id).__style, r.json.rows.find(x => x.id === mark.id).__style);

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

console.log('\n# the spreadsheet keeps its workbook while the rows are current');
const sheetKey = encodeURIComponent('board:' + boardId);
r = await call('GET', `/datasets/${sheetKey}`);
const sheetVersion = r.json.version;
const firstRowId = r.json.rows[0].id;
r = await call('GET', `/datasets/${sheetKey}/sheet`);
ok('no workbook to begin with', r.status === 200 && r.json.workbook === null && r.json.version === sheetVersion, r.json);
const workbook = { id: 'kartz', sheets: { s1: { cellData: { 0: { 0: { v: 'row id' } }, 1: { 6: { f: '=E2*2', v: 2 } } } } } };
r = await call('PUT', `/datasets/${sheetKey}/sheet`, { version: sheetVersion - 1, workbook });
ok('a workbook saved against an old version is refused', r.status === 409, r);
r = await call('PUT', `/datasets/${sheetKey}/sheet`, { version: sheetVersion, workbook });
ok('a workbook is saved', r.status === 200 && r.json.saved === true, r.json);
r = await call('GET', `/datasets/${sheetKey}/sheet`);
ok('it comes back, formula and all', r.json.workbook && r.json.workbook.sheets.s1.cellData[1][6].f === '=E2*2', r.json);
r = await call('GET', `/datasets/${sheetKey}`);
ok('the board still reads with a workbook stored', r.status === 200 && r.json.rows.length > 0, r.json);
r = await call('POST', `/datasets/${sheetKey}/ops`,
  { version: sheetVersion, ops: [{ op: 'update', id: firstRowId, values: { points: 901 } }] });
ok('the rows change elsewhere', r.status === 200 && r.json.version !== sheetVersion, r.json);
r = await call('GET', `/datasets/${sheetKey}/sheet`);
ok('the older workbook is no longer handed back', r.json.workbook === null && r.json.version !== sheetVersion, r.json);
r = await call('GET', '/datasets/roster/sheet');
const rosterSheetVersion = r.json.version;
r = await call('PUT', '/datasets/roster/sheet', { version: rosterSheetVersion, workbook });
ok('the roster keeps a workbook too', r.status === 200, r.json);
r = await call('GET', '/datasets/roster/sheet');
ok('and hands it back', !!r.json.workbook, r.json);

console.log('\n# names, passwords and who may do what');
let m = await call('POST', '/auth/signup', { name: 'Amy', password: 'amy-pass' }, null);
ok('a member signs up', m.status === 200 && m.json.user.role === 'member', m.json);
const AMY = m.json.token;
m = await call('POST', '/auth/signup', { name: '  amy ', password: 'other-pass' }, null);
ok('the same name, however it is typed, is taken', m.status === 409, m.json);
m = await call('POST', '/auth/signup', { name: 'ŊŲƁĮ', password: 'fancy-pass' }, null);
ok('fancy text is refused', m.status === 400, m.json);
m = await call('POST', '/auth/signup', { name: 'Bo', password: '123' }, null);
ok('a short password is refused', m.status === 400, m.json);
m = await call('POST', '/auth/signup', { name: 'Mallory', password: 'mallory-1', admin: true, adminCode: 'wrong' }, null);
ok('a wrong admin code is refused', m.status === 403, m.json);
m = await call('POST', '/auth/signin', { name: 'AMY', password: 'wrong-pass' }, null);
ok('a wrong password is refused', m.status === 401, m.json);
m = await call('POST', '/auth/signin', { name: 'nobody', password: 'wrong-pass' }, null);
ok('an unknown name gets the same refusal', m.status === 401 && /do not match/.test(m.json.error.message), m.json);
m = await call('POST', '/auth/signin', { name: 'AMY', password: 'amy-pass' }, null);
ok('signing in finds the account whatever the case', m.status === 200 && m.json.user.name === 'Amy', m.json);
m = await call('GET', '/auth/me', undefined, AMY);
ok('the session says who it is', m.json.user && m.json.user.name === 'Amy' && m.json.user.role === 'member', m.json);

const legacy = 'kartz|2026-07-01|698N';
DB._raw.exec(`INSERT INTO boards (id,event,date,alliance,label,saved_at,version) VALUES ('${legacy}','kartz','2026-07-01','698N','Final','2026-07-01T00:00:00Z',1)`);
const adminBoard = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId));
const cur = adminBoard.json.dataset;
ok("a board says who sent it", cur.owner === 'Tahp' && !!cur.ownerId, cur);
m = await call('DELETE', '/boards/' + encodeURIComponent(boardId), undefined, AMY);
ok("a member cannot delete someone else's board", m.status === 403, m.json);
m = await call('DELETE', '/boards/' + encodeURIComponent(legacy), undefined, AMY);
ok('a member cannot delete a board from before accounts', m.status === 403 && /admin/.test(m.json.error.message), m.json);
m = await call('PATCH', '/boards/' + encodeURIComponent(boardId), { label: 'Day 4' }, AMY);
ok("a member cannot rename someone else's board", m.status === 403, m.json);
m = await call('PUT', `/datasets/${encodeURIComponent('board:' + boardId)}/sheet`, { version: 1, workbook: {} }, AMY);
ok('a member cannot save the spreadsheet', m.status === 403, m.json);
m = await call('GET', `/datasets/${encodeURIComponent('board:' + boardId)}/sheet`, undefined, AMY);
ok('or open it', m.status === 403, m.json);
m = await call('PUT', '/roster/rows', { rows: [], allowEmpty: true }, AMY);
ok('a member cannot replace the roster', m.status === 403, m.json);
m = await call('GET', '/users', undefined, AMY);
ok('a member cannot list the accounts', m.status === 403, m.json);

const extract = mode => ({ mode, date: cur.date, alliance: cur.alliance, label: cur.label,
                           rows: [{ place: 1, search: 'Nubi', ingame: 'Nubi', alliance: cur.alliance, points: 1 }] });
m = await call('POST', '/commit', extract('preview'), AMY);
ok("the preview says a member may not replace someone else's board", m.json.canReplace === false && m.json.owner === 'Tahp', m.json);
m = await call('POST', '/commit', extract('replace'), AMY);
ok('and the Worker refuses the replace', m.status === 403, m.json);

m = await call('POST', '/commit', { mode: 'new', date: '2026-09-10', alliance: '698S', label: 'Day 1',
  rows: [{ place: 1, search: 'Amp', ingame: 'Amp', alliance: '698S', points: 400 }] }, AMY);
ok('a member extracts a new board', m.status === 200 && m.json.added === 1, m.json);
const amyBoard = m.json.board;
m = await call('GET', '/datasets', undefined, AMY);
const listed = m.json.boards.find(b => b.id === amyBoard);
ok('the list says she sent it', listed && listed.owner === 'Amy', listed);

const edited = await call('GET', '/datasets/' + encodeURIComponent('board:' + boardId), undefined, AMY);
m = await call('POST', `/datasets/${encodeURIComponent('board:' + boardId)}/ops`,
  { version: edited.json.version, ops: [{ op: 'update', id: edited.json.rows[0].id, values: { points: 1234 } }] }, AMY);
ok("a member can still correct someone else's board in the grid", m.status === 200 && m.json.applied === 1, m.json);
m = await call('GET', '/activity?limit=10', undefined, AMY);
const line = m.json.activity.find(x => x.kind === 'edit' && x.actor_name === 'Amy');
ok('the log says who edited it, and what the value was before and after',
   line && line.detail.changes[0].fields.points[1] === 1234 && line.detail.changes[0].fields.points[0] !== 1234, line);

const first = await summarizeSessions(env, { force: true });
m = await call('GET', '/activity?limit=20', undefined, AMY);
const session = m.json.activity.find(x => x.kind === 'summary' && x.actor_name === 'Amy');
ok('a finished editing session becomes one entry', first.summarized >= 1 && session && /^Amy edited/.test(session.summary), session);
const again = await summarizeSessions(env, { force: true });
ok('and is described once', again.summarized === 0, again);

m = await call('DELETE', '/boards/' + encodeURIComponent(amyBoard), undefined, AMY);
ok('a member deletes a board she sent', m.status === 200, m.json);
m = await call('PATCH', '/boards/' + encodeURIComponent(legacy), { ownerName: 'Amy' });
ok('an admin can give a board an owner', m.status === 200, m.json);
m = await call('DELETE', '/boards/' + encodeURIComponent(legacy), undefined, AMY);
ok('after which its owner can delete it', m.status === 200, m.json);
m = await call('POST', '/auth/signout', {}, AMY);
m = await call('GET', '/boards', undefined, AMY);
ok('a signed-out session is refused', m.status === 401, m);

// ---- the owner: one account that decides what everybody else may do ------------------------
console.log('\n# the owner');
let o = await call('POST', '/auth/signup', { name: 'Tess', password: 'tess-pass-1', admin: true,
                                             adminCode: 'test-owner-code' }, null);
ok('the owner code makes the owner, on the same box as the admin code',
   o.status === 200 && o.json.user.role === 'owner', o.json);
const OWNER = o.json.token;

o = await call('POST', '/auth/signup', { name: 'Rival', password: 'rival-pass', admin: true,
                                         adminCode: 'test-owner-code' }, null);
ok('there is only ever one owner', o.status === 403 && /already has an owner/.test(o.json.error.message), o.json);

o = await call('GET', `/datasets/${encodeURIComponent('board:' + boardId)}/sheet`, undefined, OWNER);
ok('the owner may do everything an admin may', o.status === 200, o.json);

o = await call('POST', '/auth/signin', { name: 'Amy', password: 'amy-pass' }, null);
const AMY2 = o.json.token;
o = await call('POST', '/commit', { mode: 'new', date: '2026-09-12', alliance: '698C', label: 'Day 2',
  rows: [{ place: 1, search: 'Amp', ingame: 'Amp', alliance: '698C', points: 410 }] }, AMY2);
const amyBoard2 = o.json.board;

o = await call('PATCH', '/users/u_whoever', { role: 'admin' }, AMY2);
ok('a member cannot hand out roles', o.status === 403, o.json);
o = await call('GET', '/users', undefined, OWNER);
const amy = o.json.users.find(u => u.name === 'Amy');
ok('the owner sees everybody, and what they have sent',
   o.status === 200 && amy && amy.role === 'member' && amy.boards === 1, o.json.users);
o = await call('PATCH', '/users/' + amy.id, { role: 'admin' }, SESSION);
ok('an admin cannot make another admin', o.status === 403 && /owns Kartz/.test(o.json.error.message), o.json);

o = await call('PATCH', '/users/' + amy.id, { role: 'admin' }, OWNER);
ok('the owner makes somebody an admin', o.status === 200 && o.json.user.role === 'admin', o.json);
o = await call('GET', `/datasets/${encodeURIComponent('board:' + boardId)}/sheet`, undefined, AMY2);
ok('and that is true at once, on her own session', o.status === 200, o.json);
o = await call('PATCH', '/users/' + amy.id, { role: 'member' }, OWNER);
ok('and takes it back again', o.status === 200 && o.json.user.role === 'member', o.json);
o = await call('GET', `/datasets/${encodeURIComponent('board:' + boardId)}/sheet`, undefined, AMY2);
ok('after which the spreadsheet is shut to her', o.status === 403, o.json);

const ownerRow = (await call('GET', '/users', undefined, OWNER)).json.users.find(u => u.role === 'owner');
o = await call('PATCH', '/users/' + ownerRow.id, { role: 'member' }, OWNER);
ok('the owner cannot demote themselves', o.status === 400, o.json);
o = await call('DELETE', '/users/' + ownerRow.id, undefined, OWNER);
ok('nor remove themselves', o.status === 400, o.json);

o = await call('DELETE', '/users/' + amy.id, undefined, OWNER);
ok('the owner removes an account', o.status === 200 && o.json.removed === 'Amy' && o.json.boards === 1, o.json);
o = await call('GET', '/boards', undefined, OWNER);
ok('the boards she sent are still there', o.json.boards.some(b => b.id === amyBoard2), o.json.boards.length);
o = await call('GET', '/datasets', undefined, OWNER);
ok('with nobody\u2019s name on them now',
   o.json.boards.find(b => b.id === amyBoard2).owner === null
   || o.json.boards.find(b => b.id === amyBoard2).owner === undefined, o.json.boards.find(b => b.id === amyBoard2));
o = await call('GET', '/boards', undefined, AMY2);
ok('and her session is over', o.status === 401, o);

o = await call('GET', '/activity?limit=20', undefined, OWNER);
ok('the log says what the owner did', (o.json.activity || []).some(a => a.kind === 'account'
   && a.actor_name === 'Tess' && /removed the account Amy/.test(a.summary)), o.json.activity && o.json.activity[0]);

// Handing Kartz over is the way back in if the owner ever loses the account.
o = await call('POST', '/auth/signup', { name: 'Dev', password: 'dev-pass-1' }, null);
const DEV = o.json.token;
const devId = o.json.user.id;
o = await call('PATCH', '/users/' + devId, { role: 'owner' }, OWNER);
ok('the owner can hand Kartz over', o.status === 200 && o.json.handedOver === true, o.json);
o = await call('GET', '/auth/me', undefined, OWNER);
ok('and stays on as an admin', o.json.user.role === 'admin', o.json.user);
o = await call('PATCH', '/users/' + ownerRow.id, { role: 'member' }, OWNER);
ok('but decides no more roles', o.status === 403, o.json);
o = await call('PATCH', '/users/' + ownerRow.id, { role: 'member' }, DEV);
ok('the new owner does', o.status === 200 && o.json.user.role === 'member', o.json);

console.log('\n# AI status without a provider');
r = await call('GET', '/ai/status');
ok('ai degrades gracefully', r.json.available === false && !!r.json.reason, r.json);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
