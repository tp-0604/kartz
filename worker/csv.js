/**
 * A read-only CSV of the scores, for a spreadsheet to pull.
 *
 * What it cannot do matters more than what it can: GET only, one table, no writes, no model
 * access, and a row cap. Whoever holds the token that opens it can read Kartz scores and
 * nothing else — they cannot spend the Gemini key, which is the thing on this Worker actually
 * worth protecting.
 */
import { parseJson } from './util.js';
import { rosterColumns, extraName, isExtra } from './datasets.js';

const CSV_MAX = 5000;

export function csvCell(v) {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

const csvResponse = lines => new Response(lines.join('\n'), {
  status: 200,
  headers: { 'content-type': 'text/csv; charset=utf-8',
             'cache-control': 'public, max-age=60',
             'access-control-allow-origin': '*' },
});

// The roster, for a spreadsheet that wants to mirror it. It is a read of this database now,
// not of a Google Sheet: the app is where the roster is maintained.
async function rosterCsv(env) {
  const meta = await env.DB.prepare('SELECT columns, labels, mapping FROM roster_meta WHERE id = 1').first();
  const { columns } = rosterColumns(meta);
  const { results } = await env.DB.prepare(
    'SELECT search, ingame, alliance, extra FROM roster ORDER BY sort, search COLLATE NOCASE').all();
  const body = (results || []).map(r => {
    const extra = parseJson(r.extra, {});
    return columns.map(c => isExtra(c.key) ? (extra[extraName(c.key)] ?? '') : (r[c.key] ?? ''))
                  .map(csvCell).join(',');
  });
  return csvResponse([columns.map(c => csvCell(c.header)).join(','), ...body]);
}

export async function handleCsv(request, env) {
  // HEAD as well as GET: it costs nothing to answer, and a 405 to a HEAD is the sort of thing
  // that makes a fetcher decide the URL is broken before it ever tries to read it.
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('GET only', { status: 405 });
  if (!env.DB) return new Response('no database', { status: 500 });

  const q = new URL(request.url).searchParams;
  // Same route, same token, different table: the workbook asks for ?kind=roster to see the
  // roster the app is actually using rather than the scores.
  if (q.get('kind') === 'roster') return await rosterCsv(env);

  const where = [], bind = [];
  const eq = (param, col) => {
    const v = q.get(param);
    if (v) { where.push(col + ' = ?'); bind.push(v); }
  };
  // b.alliance, not s.alliance: this column has always meant "which board was filmed", and the
  // sheet's per-alliance tabs are asking for that one. The player's own alliance rides along as
  // its own column below.
  eq('alliance', 'b.alliance');
  eq('player', 's.search');
  eq('date', 'b.date');
  eq('label', 'b.label');                       // Day 1 / Day 4 / Final
  const month = q.get('month');                 // 2026-09, the tab most people want
  if (month) { where.push('b.date LIKE ?'); bind.push(month + '%'); }

  const limit = Math.min(CSV_MAX, Math.max(1, Number(q.get('limit')) || CSV_MAX));
  const sql = `SELECT b.date AS date, b.alliance AS board_alliance, b.label AS label,
                      s.place, s.search, s.ingame, s.alliance AS player_alliance, s.points
                 FROM scores s JOIN boards b ON b.id = s.board_id`
            + (where.length ? ' WHERE ' + where.join(' AND ') : '')
            + ` ORDER BY b.date DESC, b.alliance ASC, s.place ASC LIMIT ${limit}`;
  const { results } = await env.DB.prepare(sql).bind(...bind).all();

  // Day and the player's own alliance are appended rather than inserted: a workbook that
  // already reads the first six columns keeps reading the same six.
  const head = ['Date', 'Alliance', 'Rank', 'Player', 'Name in video', 'Kartz Points',
                'Day', 'Player alliance'];
  const body = (results || []).map(r =>
    [r.date, r.board_alliance, r.place, r.search || '', r.ingame, r.points,
     r.label || '', r.player_alliance || ''].map(csvCell).join(','));
  return csvResponse([head.join(','), ...body]);
}
