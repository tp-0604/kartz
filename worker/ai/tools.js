/**
 * What the model is allowed to ask the database.
 *
 * It never writes SQL. It picks a tool and fills in arguments, and every one of those arguments
 * is checked here against a list of things that actually exist — this dataset, that column,
 * this comparison — before any statement is built. A field name that is not on the list is not
 * quoted and escaped, it is refused: the only column names that reach a query are ones this
 * file already knew about.
 *
 * Aggregation happens in SQLite, not in the model's context. "Average power by alliance" is one
 * GROUP BY returning four rows, not fifteen thousand rows and a hope.
 */
import { parseJson, str, toInt } from '../util.js';
import { rosterColumns, extraName, isExtra } from '../datasets.js';

// How alike two short names are, 0 to 1, by how many single-character edits separate them.
// Bigram overlap is the usual cheap answer and it is hopeless at this length — “Noobi” and
// “Nubi” share almost no pairs, and score no better than a name with nothing to do with them.
// Counting edits puts them two apart out of five, which is what a person means by “nearly”.
function near(a, b) {
  const x = String(a || '').toLowerCase(), y = String(b || '').toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (Math.abs(x.length - y.length) > 4 || x.length > 40 || y.length > 40) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++)
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

const ROW_CAP = 200;                 // what a single query may hand back to the model
const GROUP_CAP = 60;

// The comparisons a filter may use, and how each becomes SQL. Nothing else is accepted.
const OPS = {
  eq: (c, v) => [`${c} = ?`, [v]],
  ne: (c, v) => [`${c} <> ?`, [v]],
  gt: (c, v) => [`${c} > ?`, [v]],
  gte: (c, v) => [`${c} >= ?`, [v]],
  lt: (c, v) => [`${c} < ?`, [v]],
  lte: (c, v) => [`${c} <= ?`, [v]],
  contains: (c, v) => [`${c} LIKE ?`, ['%' + String(v).replace(/[%_]/g, m => '\\' + m) + '%']],
  starts: (c, v) => [`${c} LIKE ?`, [String(v).replace(/[%_]/g, m => '\\' + m) + '%']],
  in: (c, v) => {
    const list = (Array.isArray(v) ? v : [v]).slice(0, 50);
    return [`${c} IN (${list.map(() => '?').join(',')})`, list];
  },
  between: (c, v) => {
    const list = Array.isArray(v) ? v : [];
    if (list.length !== 2) throw new Error('between needs two values.');
    return [`${c} BETWEEN ? AND ?`, list];
  },
  is_null: c => [`${c} IS NULL`, []],
  not_null: c => [`${c} IS NOT NULL`, []],
};

const SCORE_FIELDS = {
  place:    { sql: 's.place',    type: 'int',  about: 'the rank the game showed' },
  search:   { sql: 's.search',   type: 'text', about: "the player's roster name; null for someone new" },
  ingame:   { sql: 's.ingame',   type: 'text', about: 'the name the video drew' },
  alliance: { sql: 's.alliance', type: 'text', about: "the player's own alliance" },
  points:   { sql: 's.points',   type: 'int',  about: 'Kartz points scored' },
  edited:   { sql: 's.edited',   type: 'int',  about: '1 if a person corrected this row by hand' },
  date:     { sql: 'b.date',     type: 'date', about: 'the day the board was filmed (YYYY-MM-DD)' },
  month:    { sql: "substr(b.date, 1, 7)", type: 'text', about: 'the month, YYYY-MM' },
  label:    { sql: 'b.label',    type: 'text', about: 'Day 1, Day 4 or Final' },
  board_alliance: { sql: 'b.alliance', type: 'text', about: 'whose board was filmed' },
  board_id: { sql: 's.board_id', type: 'text', about: 'which board this row belongs to' },
};
const ROSTER_FIELDS = {
  search:   { sql: 'r.search',   type: 'text', about: "the player's identity; every score points at it" },
  ingame:   { sql: 'r.ingame',   type: 'text', about: 'the name the game draws' },
  alliance: { sql: 'r.alliance', type: 'text', about: "the player's alliance" },
};

// A heading is only ever taken from the dataset's own list, so what reaches the SQL is a string
// this Worker read out of its own database — never one the model invented.
const extraSql = (column, heading) => `json_extract(${column}, '$."${heading.replace(/"/g, '')}"')`;

async function extrasFor(env, kind, boardId) {
  if (kind === 'roster') {
    const meta = await env.DB.prepare('SELECT columns, mapping, labels FROM roster_meta WHERE id = 1').first();
    const { columns } = rosterColumns(meta);
    return columns.filter(c => isExtra(c.key)).map(c => extraName(c.key));
  }
  if (!boardId) return [];
  const meta = await env.DB.prepare('SELECT columns FROM board_meta WHERE board_id = ?').bind(boardId).first();
  return parseJson(meta && meta.columns, []);
}

/**
 * Turn a dataset name into something queryable, or say why it is not one.
 *   roster                 the player list
 *   board:<id>             one board
 *   scores                 every score ever saved
 *   month:YYYY-MM          every score in one month
 */
export async function resolveScope(env, dataset) {
  const name = str(dataset) || 'scores';
  if (name === 'roster') {
    const extras = await extrasFor(env, 'roster');
    const fields = { ...ROSTER_FIELDS };
    for (const h of extras)
      fields['x:' + h] = { sql: extraSql('r.extra', h), type: 'text', about: `the roster's own “${h}” column` };
    return { kind: 'roster', name, from: 'roster r', where: [], binds: [], fields,
             label: 'the roster' };
  }
  if (name === 'scores')
    return { kind: 'scores', name, from: 'scores s JOIN boards b ON b.id = s.board_id',
             where: [], binds: [], fields: { ...SCORE_FIELDS }, label: 'every board saved' };
  if (name.startsWith('month:')) {
    const month = name.slice(6);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`“${month}” is not a month (YYYY-MM).`);
    return { kind: 'scores', name, from: 'scores s JOIN boards b ON b.id = s.board_id',
             where: ['b.date LIKE ?'], binds: [month + '%'], fields: { ...SCORE_FIELDS },
             label: `every board in ${month}` };
  }
  if (name.startsWith('board:')) {
    const id = name.slice(6);
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) throw new Error(`there is no board “${id}”. Use list_datasets to see which boards exist.`);
    const extras = await extrasFor(env, 'board', id);
    const fields = { ...SCORE_FIELDS };
    for (const h of extras)
      fields['x:' + h] = { sql: extraSql('s.extra', h), type: 'text', about: `this board's own “${h}” column` };
    return { kind: 'scores', name, from: 'scores s JOIN boards b ON b.id = s.board_id',
             where: ['s.board_id = ?'], binds: [id], fields, board,
             label: `${board.alliance} on ${board.date}${board.label ? ' (' + board.label + ')' : ''}` };
  }
  throw new Error(`“${name}” is not a dataset. Use roster, scores, month:YYYY-MM, or board:<id>.`);
}

function column(scope, field) {
  const f = scope.fields[str(field)];
  if (!f) throw new Error(
    `there is no column “${field}” in ${scope.label}. It has: ${Object.keys(scope.fields).join(', ')}.`);
  return f;
}

function buildWhere(scope, filters) {
  const where = scope.where.slice(), binds = scope.binds.slice();
  for (const f of (Array.isArray(filters) ? filters : []).slice(0, 12)) {
    const op = str(f && f.op) || 'eq';
    const make = OPS[op];
    if (!make) throw new Error(`“${op}” is not a comparison. Use one of: ${Object.keys(OPS).join(', ')}.`);
    const col = column(scope, f.field);
    const [sql, vals] = make(col.sql, f.value);
    where.push(sql);
    binds.push(...vals);
  }
  return { where, binds };
}

const clause = where => (where.length ? ' WHERE ' + where.join(' AND ') : '');

// ---------------------------------------------------------------------------------------
// The tools themselves. Each returns plain data plus a `source` saying where it came from,
// which is what lets an answer be traced back to rows rather than taken on trust.
// ---------------------------------------------------------------------------------------
export const TOOLS = [
  {
    name: 'list_datasets',
    description: 'List the boards saved and the roster, newest board first. Use this before naming a dataset you are not sure exists.',
    schema: { type: 'object', properties: { limit: { type: 'integer', description: 'how many boards, default 40' } } },
    async run(env, args) {
      const limit = Math.min(200, Math.max(1, toInt(args.limit, 40) || 40));
      const { results } = await env.DB.prepare(
        `SELECT b.id, b.date, b.alliance, b.label, COUNT(s.id) AS rows, MAX(s.points) AS best
           FROM boards b LEFT JOIN scores s ON s.board_id = b.id
          GROUP BY b.id ORDER BY b.date DESC, b.alliance LIMIT ?`).bind(limit).all();
      const roster = await env.DB.prepare('SELECT COUNT(*) n FROM roster').first();
      const total = await env.DB.prepare('SELECT COUNT(*) n FROM boards').first();
      return {
        boards: (results || []).map(b => ({ dataset: 'board:' + b.id, date: b.date, alliance: b.alliance,
                                            label: b.label, rows: b.rows, top: b.best })),
        boardsTotal: (total && total.n) || 0,
        roster: { dataset: 'roster', players: (roster && roster.n) || 0 },
        alsoAvailable: ['scores (every board at once)', 'month:YYYY-MM (one month)'],
      };
    },
  },
  {
    name: 'get_dataset_metadata',
    description: 'The columns a dataset has, how many rows, and the range of its dates and scores. Call this before querying a dataset whose shape you do not know.',
    schema: { type: 'object', properties: { dataset: { type: 'string', description: 'roster | scores | month:YYYY-MM | board:<id>' } },
              required: ['dataset'] },
    async run(env, args) {
      const scope = await resolveScope(env, args.dataset);
      const { where, binds } = buildWhere(scope, []);
      const columns = Object.entries(scope.fields).map(([key, f]) => ({ column: key, type: f.type, about: f.about }));
      const count = await env.DB.prepare(`SELECT COUNT(*) n FROM ${scope.from}${clause(where)}`).bind(...binds).first();
      const out = { dataset: scope.name, describes: scope.label, rows: (count && count.n) || 0, columns };
      if (scope.kind === 'scores') {
        const stats = await env.DB.prepare(
          `SELECT MIN(b.date) first, MAX(b.date) last, MIN(s.points) low, MAX(s.points) high,
                  ROUND(AVG(s.points)) mean, COUNT(DISTINCT s.board_id) boards,
                  COUNT(DISTINCT s.alliance) alliances
             FROM ${scope.from}${clause(where)}`).bind(...binds).first();
        Object.assign(out, stats || {});
        if (scope.board) out.board = { date: scope.board.date, alliance: scope.board.alliance, label: scope.board.label };
      }
      return out;
    },
  },
  {
    name: 'query_records',
    description: 'Rows from a dataset, filtered and sorted. Ask for the columns you need and a small limit — this is for looking at specific rows, not for reading a dataset into your context. Use aggregate_records for anything you would otherwise total up yourself.',
    schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string', description: 'roster | scores | month:YYYY-MM | board:<id>' },
        columns: { type: 'array', items: { type: 'string' }, description: 'which columns to return; all of them if omitted' },
        filters: { type: 'array', description: 'each one narrows the rows', items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            op: { type: 'string', enum: Object.keys(OPS) },
            value: { description: 'a string, a number, or a list for in/between' },
          }, required: ['field', 'op'] } },
        sort: { type: 'object', properties: {
          field: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } },
        limit: { type: 'integer', description: `how many rows, at most ${ROW_CAP}` },
      },
      required: ['dataset'],
    },
    async run(env, args) {
      const scope = await resolveScope(env, args.dataset);
      const { where, binds } = buildWhere(scope, args.filters);
      const wanted = Array.isArray(args.columns) && args.columns.length
        ? args.columns.map(str) : Object.keys(scope.fields);
      const select = wanted.map(k => `${column(scope, k).sql} AS "${k.replace(/"/g, '')}"`).join(', ');
      let order = '';
      if (args.sort && args.sort.field) {
        const dir = str(args.sort.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        order = ` ORDER BY ${column(scope, args.sort.field).sql} ${dir}`;
      } else if (scope.kind === 'scores') order = ' ORDER BY b.date DESC, s.place ASC';
      const limit = Math.min(ROW_CAP, Math.max(1, toInt(args.limit, 25) || 25));
      const total = await env.DB.prepare(`SELECT COUNT(*) n FROM ${scope.from}${clause(where)}`).bind(...binds).first();
      const { results } = await env.DB.prepare(
        `SELECT ${select} FROM ${scope.from}${clause(where)}${order} LIMIT ?`).bind(...binds, limit).all();
      return {
        rows: results || [],
        returned: (results || []).length,
        matched: (total && total.n) || 0,
        truncated: ((total && total.n) || 0) > (results || []).length,
        source: { dataset: scope.name, describes: scope.label, filters: args.filters || [] },
      };
    },
  },
  {
    name: 'aggregate_records',
    description: 'A number computed in the database: a count, sum, average, minimum, maximum or median, optionally grouped by a column. Always prefer this to fetching rows and adding them up.',
    schema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        metric: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max', 'median', 'count_distinct'] },
        field: { type: 'string', description: 'the column the metric is computed over; not needed for count' },
        groupBy: { type: 'string', description: 'a column to group by, e.g. alliance or date' },
        filters: { type: 'array', items: { type: 'object', properties: {
          field: { type: 'string' }, op: { type: 'string', enum: Object.keys(OPS) }, value: {} },
          required: ['field', 'op'] } },
        sort: { type: 'string', enum: ['value', 'group'], description: 'order the groups by their value (default) or by their name' },
        limit: { type: 'integer' },
      },
      required: ['dataset', 'metric'],
    },
    async run(env, args) {
      const scope = await resolveScope(env, args.dataset);
      const { where, binds } = buildWhere(scope, args.filters);
      const metric = str(args.metric) || 'count';
      let expr;
      if (metric === 'count') expr = 'COUNT(*)';
      else if (metric === 'count_distinct') expr = `COUNT(DISTINCT ${column(scope, args.field).sql})`;
      else if (metric === 'median') expr = null;
      else {
        const col = column(scope, args.field);
        if (col.type === 'text' && metric !== 'min' && metric !== 'max')
          throw new Error(`“${args.field}” holds text, so a ${metric} of it is not a number. Use count, or pick a numeric column.`);
        expr = `${metric.toUpperCase()}(${col.sql})`;
      }
      const group = args.groupBy ? column(scope, args.groupBy) : null;
      const limit = Math.min(GROUP_CAP, Math.max(1, toInt(args.limit, GROUP_CAP) || GROUP_CAP));

      if (metric === 'median') {
        // SQLite has no median, and pulling every value back to find one would be the very
        // thing this tool exists to avoid. The middle row is asked for by its offset.
        const col = column(scope, args.field);
        if (group) throw new Error('a median cannot be grouped here. Ask for an average instead, or a median of one group at a time.');
        const n = await env.DB.prepare(
          `SELECT COUNT(*) c FROM ${scope.from}${clause([...where, `${col.sql} IS NOT NULL`])}`).bind(...binds).first();
        const count = (n && n.c) || 0;
        if (!count) return { value: null, rows: 0, source: { dataset: scope.name } };
        const mid = await env.DB.prepare(
          `SELECT ${col.sql} v FROM ${scope.from}${clause([...where, `${col.sql} IS NOT NULL`])}
            ORDER BY ${col.sql} LIMIT 1 OFFSET ?`).bind(...binds, Math.floor((count - 1) / 2)).first();
        return { metric: 'median', field: args.field, value: mid ? mid.v : null, rows: count,
                 source: { dataset: scope.name, describes: scope.label, filters: args.filters || [] } };
      }

      if (!group) {
        const row = await env.DB.prepare(`SELECT ${expr} v, COUNT(*) n FROM ${scope.from}${clause(where)}`)
          .bind(...binds).first();
        return { metric, field: args.field || null, value: row ? row.v : null, rows: row ? row.n : 0,
                 source: { dataset: scope.name, describes: scope.label, filters: args.filters || [] } };
      }
      const order = str(args.sort) === 'group' ? 'grp ASC' : 'value DESC';
      const { results } = await env.DB.prepare(
        `SELECT ${group.sql} grp, ${expr} value, COUNT(*) rows FROM ${scope.from}${clause(where)}
          GROUP BY ${group.sql} ORDER BY ${order} LIMIT ?`).bind(...binds, limit).all();
      return {
        metric, field: args.field || null, groupBy: args.groupBy,
        groups: (results || []).map(r => ({ group: r.grp, value: r.value, rows: r.rows })),
        source: { dataset: scope.name, describes: scope.label, filters: args.filters || [] },
      };
    },
  },
  {
    name: 'compare_datasets',
    description: 'Two boards side by side, joined on the player: who gained, who lost, who is only on one of them. Use it for "compare with the previous snapshot" and "who gained the most".',
    schema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'the earlier dataset, board:<id>' },
        b: { type: 'string', description: 'the later dataset, board:<id>' },
        sort: { type: 'string', enum: ['gain', 'loss', 'rank_gain', 'rank_loss'], description: 'default gain' },
        limit: { type: 'integer' },
      },
      required: ['a', 'b'],
    },
    async run(env, args) {
      const A = await resolveScope(env, args.a), B = await resolveScope(env, args.b);
      if (A.kind !== 'scores' || B.kind !== 'scores')
        throw new Error('compare_datasets compares two boards of scores.');
      const limit = Math.min(ROW_CAP, Math.max(1, toInt(args.limit, 25) || 25));
      const key = 'COALESCE(s.search, s.ingame)';
      const rowsOf = async scope => {
        const { where, binds } = buildWhere(scope, []);
        const { results } = await env.DB.prepare(
          `SELECT ${key} k, s.place, s.points, s.alliance, s.ingame FROM ${scope.from}${clause(where)}`)
          .bind(...binds).all();
        return results || [];
      };
      const [ra, rb] = [await rowsOf(A), await rowsOf(B)];
      const byA = new Map(ra.map(r => [r.k, r]));
      const both = [], onlyB = [];
      for (const r of rb) {
        const was = byA.get(r.k);
        if (!was) { onlyB.push({ player: r.k, points: r.points, place: r.place }); continue; }
        both.push({ player: r.k, alliance: r.alliance || was.alliance,
                    before: was.points, after: r.points, change: r.points - was.points,
                    placeBefore: was.place, placeAfter: r.place, placeChange: was.place - r.place });
        byA.delete(r.k);
      }
      const onlyA = [...byA.values()].map(r => ({ player: r.k, points: r.points, place: r.place }));
      const sort = str(args.sort) || 'gain';
      const cmp = { gain: (x, y) => y.change - x.change, loss: (x, y) => x.change - y.change,
                    rank_gain: (x, y) => y.placeChange - x.placeChange,
                    rank_loss: (x, y) => x.placeChange - y.placeChange }[sort] || ((x, y) => y.change - x.change);
      both.sort(cmp);
      return {
        compared: both.length, onlyInA: onlyA.length, onlyInB: onlyB.length,
        rows: both.slice(0, limit),
        missing: { fromA: onlyA.slice(0, 20), fromB: onlyB.slice(0, 20) },
        source: { a: A.name, aDescribes: A.label, b: B.name, bDescribes: B.label },
      };
    },
  },
  {
    name: 'get_trend',
    description: 'One number per board over time — total, average or top score — so a change across snapshots can be seen rather than guessed at.',
    schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['avg', 'sum', 'max', 'count'], description: 'default avg' },
        field: { type: 'string', description: 'default points' },
        alliance: { type: 'string', description: 'restrict to boards filmed for one alliance' },
        label: { type: 'string', description: 'restrict to Day 1, Day 4 or Final' },
        from: { type: 'string', description: 'earliest date, YYYY-MM-DD' },
        to: { type: 'string', description: 'latest date, YYYY-MM-DD' },
        by: { type: 'string', enum: ['board', 'month'], description: 'default board' },
        limit: { type: 'integer', description: 'how many points, most recent first; default 24' },
      },
    },
    async run(env, args) {
      const scope = await resolveScope(env, 'scores');
      const filters = [];
      if (str(args.alliance)) filters.push({ field: 'board_alliance', op: 'eq', value: str(args.alliance) });
      if (str(args.label)) filters.push({ field: 'label', op: 'eq', value: str(args.label) });
      if (str(args.from)) filters.push({ field: 'date', op: 'gte', value: str(args.from) });
      if (str(args.to)) filters.push({ field: 'date', op: 'lte', value: str(args.to) });
      const { where, binds } = buildWhere(scope, filters);
      const metric = (str(args.metric) || 'avg').toUpperCase();
      if (!['AVG', 'SUM', 'MAX', 'COUNT'].includes(metric)) throw new Error('metric must be avg, sum, max or count.');
      const col = column(scope, str(args.field) || 'points');
      const expr = metric === 'COUNT' ? 'COUNT(*)' : `ROUND(${metric}(${col.sql}))`;
      const by = str(args.by) === 'month' ? "substr(b.date, 1, 7)" : 'b.date';
      const limit = Math.min(120, Math.max(1, toInt(args.limit, 24) || 24));
      const { results } = await env.DB.prepare(
        `SELECT ${by} period, b.alliance alliance, b.label label, ${expr} value, COUNT(*) rows
           FROM ${scope.from}${clause(where)}
          GROUP BY ${by}${str(args.by) === 'month' ? '' : ', b.alliance'}
          ORDER BY period DESC LIMIT ?`).bind(...binds, limit).all();
      const points = (results || []).slice().reverse();
      return {
        points, count: points.length,
        available: points.length > 0,
        reason: points.length ? null : 'no board matches that period or alliance.',
        source: { dataset: 'scores', describes: 'every board saved', filters },
      };
    },
  },
  {
    name: 'get_player_history',
    description: "Every board one player appears on, oldest first: their rank, their score and which alliance's board it was.",
    schema: { type: 'object', properties: {
      player: { type: 'string', description: 'the roster name' },
      limit: { type: 'integer' } }, required: ['player'] },
    async run(env, args) {
      const who = str(args.player);
      if (!who) throw new Error('player is required.');
      const limit = Math.min(ROW_CAP, Math.max(1, toInt(args.limit, 60) || 60));
      const { results } = await env.DB.prepare(
        `SELECT b.date, b.alliance AS board, b.label, s.place, s.ingame, s.alliance, s.points
           FROM scores s JOIN boards b ON b.id = s.board_id
          WHERE s.search = ? ORDER BY b.date ASC LIMIT ?`).bind(who, limit).all();
      if (!(results || []).length) {
        // A name that finds nothing is usually spelled nearly right, and LIKE cannot see that:
        // “Noobi” contains no substring of “Nubi”. So the roster's names are ranked by how much
        // of the query they share. It is a few hundred short strings, on a path that has
        // already failed, and it turns a dead end into the answer the user meant.
        const { results: names } = await env.DB.prepare('SELECT search, ingame FROM roster').all();
        const ranked = (names || [])
          .map(r => ({ name: r.search, score: Math.max(near(who, r.search), near(who, r.ingame)) }))
          .filter(x => x.score >= 0.55)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6);
        return { available: false,
                 reason: `no scores are saved under the roster name “${who}”.`,
                 didYouMean: ranked.map(x => x.name) };
      }
      return { available: true, player: who, rows: results,
               source: { dataset: 'scores', describes: `every board “${who}” appears on` } };
    },
  },
  {
    name: 'search_players',
    description: 'Find players on the roster by part of either name. Use it to turn something the user typed into the roster name the other tools want.',
    schema: { type: 'object', properties: {
      query: { type: 'string' }, alliance: { type: 'string' }, limit: { type: 'integer' } } },
    async run(env, args) {
      const q = str(args.query);
      const limit = Math.min(ROW_CAP, Math.max(1, toInt(args.limit, 25) || 25));
      const where = [], binds = [];
      if (q) { where.push('(search LIKE ? OR ingame LIKE ?)'); binds.push('%' + q + '%', '%' + q + '%'); }
      if (str(args.alliance)) { where.push('alliance = ?'); binds.push(str(args.alliance)); }
      const { results } = await env.DB.prepare(
        `SELECT search, ingame, alliance FROM roster${clause(where)} ORDER BY search COLLATE NOCASE LIMIT ?`)
        .bind(...binds, limit).all();
      return { players: results || [], source: { dataset: 'roster' } };
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

/** The workspace as the browser last described it. Not a query — it is the client's own state. */
export function workspaceTool(context) {
  return {
    name: 'get_workspace_context',
    description: 'What the user is looking at right now: which dataset is open, which filters and sort are applied, how many rows those leave, which columns are visible and how many rows are selected. Call it whenever the question says "these", "this board", "the selected rows" or "currently".',
    schema: { type: 'object', properties: {} },
    async run() {
      if (!context || !context.dataset)
        return { available: false, reason: 'the browser did not say what is open.' };
      return { available: true, ...context };
    },
  };
}
