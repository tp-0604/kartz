/**
 * Kartz key holder — a Cloudflare Worker that keeps the Gemini key off the page.
 *
 * A static site cannot hold a secret. Anything index.html sends, a viewer can read out of
 * the network tab in about ten seconds, so obfuscating the key in JavaScript buys nothing.
 * The only real fix is for the key to live somewhere the browser never sees, and for the
 * browser to talk to that instead. This Worker is that somewhere.
 *
 * It is a thin pass-through: the page posts the ordinary Gemini request body to
 * POST /<model>, the Worker adds the key and forwards it to Google. The page's model
 * fallback chain therefore keeps working unchanged.
 *
 * Normally this runs as part of the Cloudflare Pages deployment, mounted at /api by
 * functions/api/[[path]].js. In that arrangement the page and this code share an origin,
 * secrets come from the project's settings, and ALLOWED_ORIGINS can stay empty.
 *
 * It also stands alone as a plain Worker, for hosting the page somewhere else:
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler deploy
 *   3. wrangler secret put GEMINI_KEY     <- your key, at the prompt
 *   4. wrangler secret put SHARED_PASS    <- the phrase you give your officers
 *   5. Add the page's origin to ALLOWED_ORIGINS below, then deploy again.
 *
 * Either way the key only ever exists in Cloudflare.
 */

// Extra origins allowed to call this, for when the page is hosted somewhere else — GitHub
// Pages, say. Anything served from this same deployment is allowed automatically, so on
// Cloudflare Pages this list can stay empty.
const ALLOWED_ORIGINS = [
  'http://localhost:8731',
];

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/models';

// Cloudflare's own models can be reached from inside a Worker through the AI binding.
// They are deliberately NOT reachable from the page: the Workers AI REST API answers a
// CORS preflight with 405 and sets no allow-origin header on the response either, so a
// static site cannot call it however the request is shaped. Running it here sidesteps that
// and keeps the account token out of the browser at the same time.
//
// The page always speaks the Gemini request shape, so translate in both directions rather
// than teaching the page a third dialect.
async function runWorkersAI(env, model, body) {
  if (!env.AI) throw new Error('This Worker has no AI binding. Add [ai]\nbinding = "AI" to wrangler.toml.');
  const parts = body?.contents?.[0]?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('\n');
  const images = parts.filter(p => p.inline_data).map(p => p.inline_data.data);
  const content = [
    ...images.map(d => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + d } })),
    { type: 'text', text },
  ];
  const out = await env.AI.run(model, {
    messages: [{ role: 'user', content }],
    max_tokens: 4096,
    temperature: 0,
  });
  const reply = out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content ?? '';
  // hand it back in the shape the page already parses
  return { candidates: [{ content: { parts: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] } }] };
}

// ---------------------------------------------------------------------------------------
// Kartz history.
//
// The scores used to exist only as a block pasted into a spreadsheet tab, one tab per month,
// and the shape of those tabs drifted five times in two years. Here they are rows: each one
// carries its own date and alliance, so nothing ever needs reshaping and a question like
// "how has this player gone since June" is a query rather than an afternoon.
//
// A run is identified by its date and alliance together. Uploading the same alliance twice on
// the same day replaces it rather than doubling every score, which is the obvious way for two
// officers to corrupt a shared table without noticing.
const MAX_ROWS = 500;                       // a Kartz board is ~150; this is a sanity bound
const boardId = (event, date, alliance) => `${event}|${date}|${alliance}`;

async function handleData(seg, request, env, reply) {
  if (!env.DB) return reply({ error: { code: 500,
    message: 'This Worker has no DB binding. Create the database with "wrangler d1 create '
           + 'kartz-db", put the id in wrangler.toml, and deploy again.' } }, 500);
  const url = new URL(request.url);
  const q = url.searchParams;
  const method = request.method;

  // ---- roster overrides -----------------------------------------------------------------
  // What this stores is a diff, not a roster. The sheet stays the place new players arrive,
  // and these rows say what the app disagrees with — so "Pull / Update Roster" stops being a
  // thing that quietly undoes an afternoon of corrections.
  if (seg === 'roster' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT search, ingame, alliance, added, removed, edited_at FROM roster_edits'
      + ' ORDER BY search COLLATE NOCASE').all();
    return reply({ edits: results || [] }, 200);
  }

  if (seg === 'roster' && (method === 'PUT' || method === 'POST')) {
    const body = await request.json().catch(() => null);
    const search = body && body.search ? String(body.search).trim() : '';
    if (!search) return reply({ error: { code: 400, message: 'a roster name is required' } }, 400);
    // undefined means "not mentioned, leave it"; empty string means "clear this override and
    // go back to whatever the sheet says". They are different answers and the API keeps them
    // apart, because otherwise reverting one field would be impossible to express.
    const opt = v => v === undefined ? null : (String(v).trim() || null);
    await env.DB.prepare(
      `INSERT INTO roster_edits (search, ingame, alliance, added, removed, edited_at)
            VALUES (?,?,?,?,?,?)
       ON CONFLICT(search) DO UPDATE SET
            ingame   = COALESCE(excluded.ingame,   roster_edits.ingame),
            alliance = COALESCE(excluded.alliance, roster_edits.alliance),
            added    = excluded.added,
            removed  = excluded.removed,
            edited_at = excluded.edited_at`)
      .bind(search, opt(body.ingame), opt(body.alliance),
            body.added ? 1 : 0, body.removed ? 1 : 0, new Date().toISOString()).run();
    const row = await env.DB.prepare('SELECT * FROM roster_edits WHERE search = ?')
      .bind(search).first();
    return reply({ edit: row }, 200);
  }

  // Dropping the override is how a row goes back to the sheet's version. Deleting the player
  // is a different thing entirely and is the removed flag above.
  if (seg === 'roster' && method === 'DELETE') {
    const search = q.get('search') || '';
    if (!search) return reply({ error: { code: 400, message: 'a roster name is required' } }, 400);
    const r = await env.DB.prepare('DELETE FROM roster_edits WHERE search = ?').bind(search).run();
    return reply({ reverted: search, changes: (r.meta && r.meta.changes) || 0 }, 200);
  }

  // ---- the index: every board saved, newest first --------------------------------------
  if (seg === 'boards' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.event, b.date, b.alliance, b.label, b.saved_at,
              COUNT(s.place) AS players, MAX(s.points) AS best
         FROM boards b LEFT JOIN scores s ON s.board_id = b.id
        GROUP BY b.id ORDER BY b.date DESC, b.alliance ASC`).all();
    return reply({ boards: results }, 200);
  }

  // ---- one board's rows, in the order the game had them ---------------------------------
  if (seg === 'board' && method === 'GET') {
    const id = q.get('id') || '';
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const { results } = await env.DB.prepare(
      `SELECT place, search, ingame, alliance, points, edited FROM scores
        WHERE board_id = ? ORDER BY place`).bind(id).all();
    return reply({ board, rows: results }, 200);
  }

  // ---- save a board, replacing any board with the same event, date and alliance ---------
  if (seg === 'runs' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const event = String(body && body.event || 'kartz').trim() || 'kartz';
    const date = String(body && body.date || '').trim();
    const alliance = String(body && body.alliance || '').trim();
    const label = body && body.label ? String(body.label).trim() : null;
    const rows = Array.isArray(body && body.rows) ? body.rows : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return reply({ error: { code: 400, message: 'date must be YYYY-MM-DD.' } }, 400);
    if (!alliance) return reply({ error: { code: 400, message: 'alliance is required.' } }, 400);
    if (!rows || !rows.length)
      return reply({ error: { code: 400, message: 'rows is required.' } }, 400);
    if (rows.length > MAX_ROWS)
      return reply({ error: { code: 400, message: `too many rows (${rows.length}).` } }, 400);

    const id = boardId(event, date, alliance);
    // Corrections made by hand survive a re-save. Re-extracting the same recording to pick up
    // a better reading elsewhere should not silently undo the name somebody fixed by typing it.
    const { results: kept } = await env.DB.prepare(
      'SELECT place, search, ingame, alliance, points FROM scores WHERE board_id = ? AND edited = 1')
      .bind(id).all();
    const byPlace = new Map((kept || []).map(r => [r.place, r]));

    const ins = env.DB.prepare(
      `INSERT INTO scores (board_id, place, search, ingame, alliance, points, edited)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const stmts = [
      env.DB.prepare('DELETE FROM scores WHERE board_id = ?').bind(id),
      env.DB.prepare(
        `INSERT INTO boards (id, event, date, alliance, label, saved_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET label = COALESCE(excluded.label, boards.label),
                                       saved_at = excluded.saved_at`)
        .bind(id, event, date, alliance, label, new Date().toISOString()),
    ];
    const seen = new Set();
    for (const r of rows) {
      const place = Number(r.place ?? r.rank);
      const points = Number(r.points);
      const ingame = String(r.ingame ?? r.name ?? '').trim();
      if (!Number.isFinite(place) || place <= 0 || !ingame) continue;
      if (seen.has(place)) continue;          // the primary key would reject the whole batch
      seen.add(place);
      const fixed = byPlace.get(place);
      stmts.push(fixed
        ? ins.bind(id, place, fixed.search, fixed.ingame, fixed.alliance, fixed.points, 1)
        : ins.bind(id, place, r.search ? String(r.search).trim() : null, ingame,
                   r.alliance ? String(r.alliance).trim() : null,
                   Number.isFinite(points) ? points : 0, 0));
    }
    await env.DB.batch(stmts);
    return reply({ saved: stmts.length - 2, board: id, kept: byPlace.size }, 200);
  }

  // ---- relabel a board: its date, alliance, event or label, without touching the scores --
  if (seg === 'board' && method === 'PATCH') {
    const body = await request.json().catch(() => null);
    const id = String(body && body.id || '');
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const event = String(body.event ?? board.event).trim();
    const date = String(body.date ?? board.date).trim();
    const alliance = String(body.alliance ?? board.alliance).trim();
    const label = body.label === undefined ? board.label
                : (String(body.label).trim() || null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return reply({ error: { code: 400, message: 'date must be YYYY-MM-DD.' } }, 400);
    const next = boardId(event, date, alliance);
    if (next !== id) {
      const clash = await env.DB.prepare('SELECT id FROM boards WHERE id = ?').bind(next).first();
      if (clash) return reply({ error: { code: 409,
        message: `a board already exists for ${alliance} on ${date}.` } }, 409);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE boards SET id=?, event=?, date=?, alliance=?, label=? WHERE id=?')
        .bind(next, event, date, alliance, label, id),
      env.DB.prepare('UPDATE scores SET board_id=? WHERE board_id=?').bind(next, id),
    ]);
    return reply({ board: next, renamed: next !== id }, 200);
  }

  // ---- throw a board away, scores and all -----------------------------------------------
  if (seg === 'board' && method === 'DELETE') {
    const id = q.get('id') || '';
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM scores WHERE board_id = ?')
                          .bind(id).first();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM scores WHERE board_id = ?').bind(id),
      env.DB.prepare('DELETE FROM boards WHERE id = ?').bind(id),
    ]);
    return reply({ deleted: id, rows: (n && n.n) || 0 }, 200);
  }

  // ---- correct one row, and mark that a person did it ------------------------------------
  if (seg === 'score' && method === 'PATCH') {
    const body = await request.json().catch(() => null);
    const id = String(body && body.board || '');
    const place = Number(body && body.place);
    if (!id || !Number.isFinite(place))
      return reply({ error: { code: 400, message: 'board and place are required.' } }, 400);
    const row = await env.DB.prepare('SELECT * FROM scores WHERE board_id=? AND place=?')
                            .bind(id, place).first();
    if (!row) return reply({ error: { code: 404, message: 'no such row' } }, 404);
    const search = body.search === undefined ? row.search
                 : (String(body.search).trim() || null);
    const ingame = body.ingame === undefined ? row.ingame : String(body.ingame).trim();
    const alliance = body.alliance === undefined ? row.alliance
                   : (String(body.alliance).trim() || null);
    const points = body.points === undefined ? row.points : Number(body.points);
    if (!ingame) return reply({ error: { code: 400, message: 'a name is required.' } }, 400);
    if (!Number.isFinite(points))
      return reply({ error: { code: 400, message: 'points must be a number.' } }, 400);
    await env.DB.prepare(
      `UPDATE scores SET search=?, ingame=?, alliance=?, points=?, edited=1
        WHERE board_id=? AND place=?`)
      .bind(search, ingame, alliance, points, id, place).run();
    return reply({ updated: { place, search, ingame, alliance, points } }, 200);
  }

  // ---- one alliance, one month, scoring days across the top ------------------------------
  if (seg === 'month' && method === 'GET') {
    const month = q.get('month') || '';
    const alliance = q.get('alliance') || '';
    const event = q.get('event') || 'kartz';
    if (!/^\d{4}-\d{2}$/.test(month))
      return reply({ error: { code: 400, message: 'month must be YYYY-MM.' } }, 400);
    const where = ['b.event = ?', "b.date LIKE ?"], bind = [event, month + '%'];
    if (alliance) { where.push('b.alliance = ?'); bind.push(alliance); }
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.date, b.label, b.alliance AS board_alliance,
              s.place, s.search, s.ingame, s.alliance, s.points
         FROM boards b JOIN scores s ON s.board_id = b.id
        WHERE ${where.join(' AND ')}
        ORDER BY b.date ASC, s.place ASC`).bind(...bind).all();
    return reply({ month, alliance, rows: results }, 200);
  }

  // ---- everything one player has ever scored --------------------------------------------
  if (seg === 'player' && method === 'GET') {
    const who = q.get('search') || '';
    if (!who) return reply({ error: { code: 400, message: 'search is required.' } }, 400);
    const { results } = await env.DB.prepare(
      `SELECT b.date, b.alliance AS board, b.label, s.place, s.ingame, s.alliance, s.points
         FROM scores s JOIN boards b ON b.id = s.board_id
        WHERE s.search = ? ORDER BY b.date ASC`).bind(who).all();
    return reply({ history: results }, 200);
  }

  // ---- everything, for the table view and for getting the data back out -------------------
  if (seg === 'all' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT b.date, b.event, b.alliance AS board, b.label, s.place, s.search, s.ingame,
              s.alliance, s.points, s.edited
         FROM scores s JOIN boards b ON b.id = s.board_id
        ORDER BY b.date DESC, b.alliance ASC, s.place ASC`).all();
    return reply({ rows: results }, 200);
  }

  return null;                              // not a data route; fall through to the model
}

// A read-only CSV of the scores, for a spreadsheet to pull.
//
// What it cannot do matters more than what it can: GET only, one table, no writes, no model
// access, and a row cap. Whoever holds the token that opens it can read Kartz scores and
// nothing else — they cannot spend the Gemini key, which is the thing on this Worker actually
// worth protecting.
const CSV_MAX = 5000;

function csvCell(v) {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

// The same tab the app pulls from, exported as CSV. Link-readable, so no credential is
// involved — this is the Worker reading exactly what a browser would.
const ROSTER_SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/1aXTc9v4jHtB5Ma598R3Qfij-vsMlDhXho9bP_m2M5kE'
  + '/export?format=csv&gid=767166123';

// Minimal RFC4180 reader — roster names legitimately contain commas and newlines.
function readCsv(text) {
  const rows = [[]]; let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { rows[rows.length - 1].push(cell); cell = ''; }
    else if (c === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]); }
    else if (c !== '\r') cell += c;
  }
  rows[rows.length - 1].push(cell);
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// The roster the app actually uses: the sheet, with this database's corrections applied.
//
// This exists so the workbook can show what the app believes without anybody having to trust
// that the two agree. It is a mirror and must stay one — point a sheet formula at this and
// write the result into the tab the app pulls from, and the two feed each other in a circle.
async function rosterCsv(env) {
  const r = await fetch(ROSTER_SHEET_CSV, { cf: { cacheTtl: 120 } });
  if (!r.ok) return new Response('could not read the roster sheet (' + r.status + ')', { status: 502 });
  const rows = readCsv(await r.text());
  const sheet = rows
    .map(c => ({ search: (c[0] || '').trim(),
                 ingame: (c[1] || c[0] || '').trim(),
                 alliance: (c[2] || '').trim() }))
    .filter(x => x.search && !/^search\s*name/i.test(x.search));

  const { results } = await env.DB.prepare(
    'SELECT search, ingame, alliance, added, removed FROM roster_edits').all();
  const edits = new Map((results || []).map(e => [e.search, e]));

  const out = [];
  for (const row of sheet) {
    const e = edits.get(row.search);
    if (e && e.removed) continue;
    out.push({ ...row,
               ingame:   (e && e.ingame)   || row.ingame,
               alliance: (e && e.alliance) || row.alliance,
               source:   e ? 'edited' : 'sheet' });
    if (e) edits.delete(row.search);
  }
  // Whatever is left was created in the app and has no counterpart in the sheet.
  for (const e of edits.values())
    if (e.added && !e.removed)
      out.push({ search: e.search, ingame: e.ingame || e.search,
                 alliance: e.alliance || '', source: 'added' });

  out.sort((a, b) => a.search.localeCompare(b.search, undefined, { sensitivity: 'base' }));
  const head = ['Player', 'Name in video', 'Alliance', 'Source'];
  const body = out.map(x => [x.search, x.ingame, x.alliance, x.source].map(csvCell).join(','));
  return new Response([head.join(','), ...body].join('\n'), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8',
               'cache-control': 'public, max-age=60',
               'access-control-allow-origin': '*' },
  });
}

async function handleCsv(request, env) {
  // HEAD as well as GET: it costs nothing to answer, and a 405 to a HEAD is the sort of thing
  // that makes a fetcher decide the URL is broken before it ever tries to read it.
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('GET only', { status: 405 });
  if (!env.DB)
    return new Response('no database', { status: 500 });

  const q = new URL(request.url).searchParams;
  // Same route, same token, different table: the workbook asks for ?kind=roster to see the
  // roster the app is actually using rather than the scores.
  if (q.get('kind') === 'roster') return await rosterCsv(env);
  const where = [], bind = [];
  // Filters are all optional, and each one is a column so the same URL keeps working when the
  // schema grows an event and a board of its own.
  const eq = (param, col) => {
    const v = q.get(param);
    if (v) { where.push(col + ' = ?'); bind.push(v); }
  };
  // b.alliance, not s.alliance: this column has always meant "which board was filmed", and
  // the sheet's per-alliance tabs are asking for that one. The player's own alliance rides
  // along as its own column below.
  eq('alliance', 'b.alliance');
  eq('player', 's.search');
  eq('date', 'b.date');
  eq('label', 'b.label');                       // Day 1 / Day 4 / Final
  const month = q.get('month');                 // 2026-09, the tab most people want
  if (month) { where.push("b.date LIKE ?"); bind.push(month + '%'); }

  const limit = Math.min(CSV_MAX, Math.max(1, Number(q.get('limit')) || CSV_MAX));
  // The two-table split left this reading a `scores.date` that no longer exists, so every
  // pull from the workbook has been answering 500. The board carries the date now.
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
  return new Response([head.join(','), ...body].join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      // Sheets caches aggressively on its own; a short life here keeps a re-pull honest
      // without hammering the database every time somebody opens the workbook.
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-kartz-pass',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Anything that is not the API is the site itself. Static files are normally served
    // before this script ever runs; this covers the rest, so one deployment answers for
    // both halves and there is no second origin to authorise.
    if (!url.pathname.replace(/^\/+/, '').startsWith('api')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('No ASSETS binding: add [assets] to wrangler.toml.', { status: 500 });
    }

    // The CSV route runs ahead of the origin check, because the thing that reads it cannot
    // satisfy one: Apps Script fetches from Google's servers with no Origin, no cookies and
    // nothing to identify itself. It carries a token instead — its own, not SHARED_PASS.
    //
    // Two secrets rather than one, because they are not the same permission. SHARED_PASS opens
    // the whole API: the model, and writes to the database. A token that only ever unlocks a
    // read of one table can be pasted into a spreadsheet script, shared with whoever maintains
    // the workbook, and rotated without anyone re-authorising anything. Handing out the key
    // that spends Gemini credit, to read some game scores, would be the wrong trade.
    if (url.pathname.replace(/^\/+/, '').replace(/^api\/+/, '').split('/')[0] === 'csv') {
      const token = request.headers.get('x-kartz-token')
                 || new URL(request.url).searchParams.get('token') || '';
      const browser = !!request.headers.get('Origin') || !!request.headers.get('Sec-Fetch-Site');
      const ok = (env.SHEET_TOKEN && token === env.SHEET_TOKEN)
              || (browser && (!request.headers.get('Origin')
                   || request.headers.get('Origin') === new URL(request.url).origin
                   || ALLOWED_ORIGINS.includes(request.headers.get('Origin'))));
      if (!ok) return new Response('a token is required for this route', { status: 403 });
      try { return await handleCsv(request, env); }
      catch (e) { return new Response('error: ' + String(e && e.message || e), { status: 500 }); }
    }

    const origin = request.headers.get('Origin') || '';
    // Same-origin covers the Cloudflare Pages deployment, where the page and this code are
    // one site and no cross-origin request happens at all.
    const knownOrigin = !!origin
      && (origin === new URL(request.url).origin || ALLOWED_ORIGINS.includes(origin));
    // A request with no Origin at all is not a browser — curl, or a script. Those are fine,
    // but only when they bring the shared phrase: otherwise an unconfigured deployment is
    // an open AI proxy for anyone who finds the URL. An origin header proves nothing on its
    // own (it is trivially forged), so the phrase is the real gate; this just means a
    // deployment with no phrase set is still not usable by strangers.
    const hasPass = !!env.SHARED_PASS && request.headers.get('x-kartz-pass') === env.SHARED_PASS;
    // A same-origin GET carries no Origin header at all — browsers only send one for POST and
    // the other unsafe methods. That was invisible while every call was a POST to a model; the
    // history routes read with GET and were refused as though they came from a stranger.
    // Sec-Fetch-Site is set by the browser and cannot be written by script, so it says what
    // Origin cannot here.
    const sameSite = request.headers.get('Sec-Fetch-Site') === 'same-origin';
    const allowed = knownOrigin || sameSite || hasPass;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403,
                                  headers: allowed ? corsHeaders(origin) : {} });
    }
    if (!allowed) return new Response('origin not allowed', { status: 403 });

    const cors = corsHeaders(origin);
    const reply = (body, status) => new Response(JSON.stringify(body),
      { status, headers: { ...cors, 'content-type': 'application/json' } });

    // The data routes come first: "runs" and "player" would otherwise pass for model names
    // and be forwarded to Google.
    const seg = decodeURIComponent(
      new URL(request.url).pathname.replace(/^\/+/, '').replace(/^api\/+/, '')).split('/')[0];
    if (['runs', 'boards', 'board', 'score', 'month', 'player', 'all', 'roster'].includes(seg)) {
      try {
        const out = await handleData(seg, request, env, reply);
        if (out) return out;
      } catch (e) {
        return reply({ error: { code: 500, message: String(e && e.message || e) } }, 500);
      }
    }


    // Everything past this point is a model call, which is always a POST.
    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);

    // No separate phrase check here. The gate above already decided: a request either came
    // from an origin this deployment recognises — the site itself — or it brought the shared
    // phrase. Demanding the phrase a second time would lock out the very page being served,
    // which no longer sends one.

    // Path is /<model>, or /api/<model> when mounted as a Pages Function.
    const model = decodeURIComponent(
      new URL(request.url).pathname.replace(/^\/+/, '').replace(/^api\/+/, ''));
    const isCf = model.startsWith('@cf/');
    if (!(isCf ? /^@cf\/[a-zA-Z0-9._\/\-]{1,80}$/ : /^[a-zA-Z0-9.\-]{1,64}$/).test(model))
      return reply({ error: { code: 400, message: 'Bad model name.' } }, 400);

    // Cloudflare's own models come from the binding, so no Google key is needed for those.
    if (!isCf && !env.GEMINI_KEY)
      return reply({ error: { code: 500, message: 'Worker has no GEMINI_KEY secret set.' } }, 500);

    // Frames are large; cap the body so a stray caller cannot post something enormous.
    const body = await request.text();
    if (body.length > 25 * 1024 * 1024)
      return reply({ error: { code: 413, message: 'Request too large.' } }, 413);

    if (isCf) {
      try {
        const out = await runWorkersAI(env, model, JSON.parse(body));
        return reply(out, 200);
      } catch (e) {
        // surface it as a normal upstream failure so the page's fallback logic still applies
        return reply({ error: { code: 502, message: String(e && e.message || e) } }, 502);
      }
    }

    const upstream = await fetch(
      `${UPSTREAM}/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_KEY)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body });

    // Pass the status through untouched: the page relies on seeing 429 and 503 so it can
    // move down its fallback chain.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'content-type': upstream.headers.get('content-type') || 'application/json' },
    });
  },
};
