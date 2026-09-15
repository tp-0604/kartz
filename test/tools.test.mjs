import fs from 'node:fs';
import { makeDb, readSchema } from './d1.mjs';
import { TOOL_BY_NAME, resolveScope } from '../worker/ai/tools.js';
import { cleanAnalysis } from '../worker/ai/index.js';
import { readDataset } from '../worker/datasets.js';

const DB = makeDb(readSchema());
const env = { DB };
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, JSON.stringify(e).slice(0, 500)); } };
const raw = DB._raw;

// two boards, three days apart, so a comparison and a trend have something to work on
const mk = (id, date, alliance, label) =>
  raw.exec(`INSERT INTO boards (id,event,date,alliance,label,saved_at,version) VALUES ('${id}','kartz','${date}','${alliance}','${label}','${date}T00:00:00Z',1)`);
mk('kartz|2026-09-01|698W', '2026-09-01', '698W', 'Day 1');
mk('kartz|2026-09-04|698W', '2026-09-04', '698W', 'Day 4');
const players = [['Nubi', '698W', 600, 900], ['Goose', '698S', 500, 400], ['Amp', '698W', 300, 700]];
players.forEach(([n, a, d1, d4], i) => {
  raw.exec(`INSERT INTO scores (id,board_id,place,search,ingame,alliance,points,edited,extra,sort)
            VALUES ('a${i}','kartz|2026-09-01|698W',${i + 1},'${n}','${n}','${a}',${d1},0,'{"Notes":"n${i}"}',${i + 1})`);
  raw.exec(`INSERT INTO scores (id,board_id,place,search,ingame,alliance,points,edited,extra,sort)
            VALUES ('b${i}','kartz|2026-09-04|698W',${3 - i},'${n}','${n}','${a}',${d4},0,NULL,${i + 1})`);
});
raw.exec(`INSERT INTO board_meta (board_id,columns,layout,imported,updated_at) VALUES ('kartz|2026-09-01|698W','["Notes"]','{}',1,'x')`);
raw.exec(`INSERT INTO roster (id,search,ingame,alliance,extra,sort,updated_at) VALUES ('p1','Nubi','Nubi','698W','{"CP":"12M"}',0,'x'),('p2','Goose','Goose','698S',NULL,1,'x')`);
raw.exec(`UPDATE roster_meta SET columns='["Player","Name in video","Alliance","CP"]', mapping='{"search":"Player","ingame":"Name in video","alliance":"Alliance"}' WHERE id=1`);

const run = (name, args) => TOOL_BY_NAME.get(name).run(env, args);

console.log('\n# scope and column validation');
let r = await run('get_dataset_metadata', { dataset: 'board:kartz|2026-09-01|698W' });
ok('board metadata', r.rows === 3 && r.columns.some(c => c.column === 'x:Notes'), r);
r = await run('get_dataset_metadata', { dataset: 'roster' });
ok('roster metadata has its own column', r.columns.some(c => c.column === 'x:CP'), r.columns);

try { await run('query_records', { dataset: 'board:kartz|2026-09-01|698W', columns: ['points; DROP TABLE scores'] }); ok('injection refused', false); }
catch (e) { ok('a column name that is not a column is refused', /there is no column/.test(e.message), e.message); }
try { await run('query_records', { dataset: 'board:nope' }); ok('unknown board refused', false); }
catch (e) { ok('unknown board refused', /there is no board/.test(e.message), e.message); }
try { await run('aggregate_records', { dataset: 'scores', metric: 'sum', field: 'ingame' }); ok('sum of text refused', false); }
catch (e) { ok('sum of a text column refused', /holds text/.test(e.message), e.message); }
try { await run('query_records', { dataset: 'scores', filters: [{ field: 'points', op: 'sneaky', value: 1 }] }); ok('bad op refused', false); }
catch (e) { ok('an unknown comparison is refused', /is not a comparison/.test(e.message), e.message); }

console.log('\n# querying');
r = await run('query_records', { dataset: 'scores', filters: [{ field: 'points', op: 'gte', value: 500 }],
                                 sort: { field: 'points', direction: 'desc' }, limit: 2, columns: ['search', 'points', 'date'] });
ok('filter + sort + limit', r.rows.length === 2 && r.rows[0].points === 900 && r.matched === 4, r);
ok('truncation is reported', r.truncated === true, r);
r = await run('query_records', { dataset: 'board:kartz|2026-09-01|698W', columns: ['search', 'x:Notes'] });
ok('extra column is queryable', r.rows[0]['x:Notes'] === 'n0', r.rows);

console.log('\n# aggregation happens in the database');
r = await run('aggregate_records', { dataset: 'board:kartz|2026-09-01|698W', metric: 'avg', field: 'points' });
ok('average', Math.round(r.value) === 467, r);
r = await run('aggregate_records', { dataset: 'scores', metric: 'avg', field: 'points', groupBy: 'alliance' });
ok('grouped average', r.groups.length === 2 && r.groups[0].group === '698W', r.groups);
r = await run('aggregate_records', { dataset: 'scores', metric: 'median', field: 'points' });
ok('median', r.value === 500, r);
r = await run('aggregate_records', { dataset: 'scores', metric: 'count' });
ok('count', r.value === 6, r);

console.log('\n# comparison and trend');
r = await run('compare_datasets', { a: 'board:kartz|2026-09-01|698W', b: 'board:kartz|2026-09-04|698W', sort: 'gain' });
ok('gains are computed', r.rows[0].player === 'Amp' && r.rows[0].change === 400, r.rows);
ok('rank movement too', r.rows[0].placeChange === 2, r.rows[0]);
r = await run('get_trend', { metric: 'avg', alliance: '698W' });
ok('trend has two points, oldest first', r.points.length === 2 && r.points[0].period === '2026-09-01', r.points);
r = await run('get_trend', { alliance: 'nobody' });
ok('an empty trend says so rather than inventing one', r.available === false && !!r.reason, r);

console.log('\n# players');
r = await run('get_player_history', { player: 'Nubi' });
ok('history', r.available && r.rows.length === 2, r);
r = await run('get_player_history', { player: 'Noobi' });
ok('a missing player is honest and suggests', r.available === false && r.didYouMean.includes('Nubi'), r);
r = await run('search_players', { query: 'oos' });
ok('search', r.players.length === 1 && r.players[0].search === 'Goose', r);

console.log('\n# model output is validated, never trusted');
const dirty = cleanAnalysis({
  title: 'x'.repeat(500), summary: 'fine', confidence: 'totally-sure',
  components: [
    { type: 'script', text: 'alert(1)' },
    { type: 'text', text: '<img onerror=alert(1)>' },
    { type: 'metric', label: 'Average', value: 8.42, unit: 'M' },
    { type: 'table', columns: ['A', 'B'], rows: [[1, 2], { A: 3, B: 4 }] },
    { type: 'bar_chart', rows: [{ label: 'a', value: 1 }, { label: 'b', value: 'nope' }] },
    { type: 'line_chart', series: [{ name: 's', points: [{ x: '1', y: 1 }] }] },
  ],
  sources: [{ label: '698W, 3 rows', dataset: 'board:x', rows: 3 }],
});
ok('unknown component types are dropped', !dirty.components.some(c => c.type === 'script'), dirty.components);
ok('text is kept as text, never as markup', dirty.components[0].text === '<img onerror=alert(1)>', dirty.components[0]);
ok('table rows normalise both shapes', JSON.stringify(dirty.components[2].rows) === '[[1,2],[3,4]]', dirty.components[2]);
ok('a chart row with no number is dropped', dirty.components[3].rows.length === 1, dirty.components[3]);
ok('a one-point line is not a line', !dirty.components.some(c => c.type === 'line_chart'), dirty.components);
ok('confidence falls back to a known value', dirty.confidence === 'measured', dirty.confidence);
ok('title is capped', dirty.title.length === 120, dirty.title.length);
ok('sources survive', dirty.sources[0].rows === 3, dirty.sources);

console.log('\n# legacy workbook snapshot recovered into rows');
const DB2 = makeDb(readSchema());
DB2._raw.exec(`INSERT INTO boards (id,event,date,alliance,label,saved_at,version) VALUES ('kartz|2026-05-25|698N','kartz','2026-05-25','698N','Day 1','x',1)`);
DB2._raw.exec(`INSERT INTO scores (id,board_id,place,search,ingame,alliance,points,edited,extra,sort) VALUES ('z1','kartz|2026-05-25|698N',1,'Old','Old','698N',100,0,NULL,1)`);
const snapshot = { sheetOrder: ['s1'], styles: { st1: { bg: { rgb: '#fff2cc' }, bl: 1 } },
  sheets: { s1: { id: 's1', cellData: {
  0: { 0: { v: 'Rank' }, 1: { v: 'Player' }, 2: { v: 'Name in video' }, 3: { v: 'Alliance' }, 4: { v: 'Kartz Points' }, 5: { v: 'CP' }, 6: { v: 'Comment' } },
  1: { 0: { v: 1 }, 1: { v: 'Old', s: 'st1' }, 4: { v: 100, s: { bg: { rgb: '#d9ead3' } } },
       5: { v: '9.4M' }, 6: { v: 'was away' } },
} } } };
DB2._raw.exec(`INSERT INTO board_sheets (board_id,snapshot,updated_at) VALUES ('kartz|2026-05-25|698N','${JSON.stringify(snapshot).replace(/'/g, "''")}','x')`);
const out = await readDataset({ DB: DB2 }, 'board:kartz|2026-05-25|698N');
ok('legacy columns become real columns',
   out.columns.filter(c => c.role === 'extra').map(c => c.header).join(',') === 'CP,Comment', out.columns);
ok('legacy values land on the row', out.rows[0]['x:CP'] === '9.4M' && out.rows[0]['x:Comment'] === 'was away', out.rows);
ok('a fill set in the old workbook comes across, snapped to a swatch',
   out.rows[0].__style && out.rows[0].__style.search.bg === 'yellow', out.rows[0].__style);
ok('bold comes across too', out.rows[0].__style.search.b === 1, out.rows[0].__style);
ok('a second colour lands on its own column',
   out.rows[0].__style.points.bg === 'green', out.rows[0].__style);
const again = await readDataset({ DB: DB2 }, 'board:kartz|2026-05-25|698N');
ok('reading twice is stable', again.rows[0]['x:CP'] === '9.4M', again.rows);
ok('and the recovered marking is stable too',
   again.rows[0].__style.search.bg === 'yellow', again.rows[0].__style);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
