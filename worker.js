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
  'http://localhost:5173',              // `npm run dev` in web/ (it proxies /api, but just in case)
  'https://tp-0604.github.io',          // the React build on GitHub Pages
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

// A board's rows, written in one batch. Every way a board gets saved comes through here.
//
// mode 'merge' is the extractor's: a re-extraction of the same recording must not undo the
// row somebody fixed by typing it, so rows already marked edited are kept over the new ones.
// mode 'replace' is the sheet's: the rows arrive exactly as reviewed, each saying for itself
// whether a person changed it, and there is nothing older to defer to.
//
// The snapshot rides along with the rows and only with them. A route that changes rows without
// bringing a new snapshot drops the old one, so the sheet can never be newer or older than the
// rows it shows. expectVersion refuses a save from a copy that is behind another officer's.
const SNAPSHOT_MAX = 1_500_000;
const ROSTER_MAX = 3000;                    // the alliance roster is ~900; this is a sanity bound             // bytes of JSON; a 150-row workbook is ~50 KB

async function saveBoard(env, reply, { event, date, alliance, label, rows, sheet, mode, expectVersion }) {
  event = String(event || 'kartz').trim() || 'kartz';
  date = String(date || '').trim();
  alliance = String(alliance || '').trim();
  label = label ? String(label).trim() : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return reply({ error: { code: 400, message: 'date must be YYYY-MM-DD.' } }, 400);
  if (!alliance) return reply({ error: { code: 400, message: 'alliance is required.' } }, 400);
  if (!Array.isArray(rows) || !rows.length)
    return reply({ error: { code: 400, message: 'rows is required.' } }, 400);
  if (rows.length > MAX_ROWS)
    return reply({ error: { code: 400, message: `too many rows (${rows.length}).` } }, 400);
  let snapshot = null;
  if (sheet !== undefined && sheet !== null) {
    snapshot = typeof sheet === 'string' ? sheet : JSON.stringify(sheet);
    if (snapshot.length > SNAPSHOT_MAX)
      return reply({ error: { code: 413, message: 'the sheet snapshot is too large to store.' } }, 413);
  }

  const id = boardId(event, date, alliance);
  const existing = await env.DB.prepare('SELECT version FROM boards WHERE id = ?').bind(id).first();
  if (expectVersion !== undefined && expectVersion !== null && existing
      && Number(expectVersion) !== existing.version)
    return reply({ error: { code: 409, message:
      'this board was saved by someone else since you opened it — reload it and re-apply your edits.' },
      version: existing.version }, 409);

  // Corrections made by hand survive a re-save from the extractor.
  const byPlace = new Map();
  if (mode === 'merge' && existing) {
    const { results: kept } = await env.DB.prepare(
      'SELECT place, search, ingame, alliance, points FROM scores WHERE board_id = ? AND edited = 1')
      .bind(id).all();
    for (const r of kept || []) byPlace.set(r.place, r);
  }

  const now = new Date().toISOString();
  const ins = env.DB.prepare(
    `INSERT INTO scores (board_id, place, search, ingame, alliance, points, edited)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const stmts = [
    env.DB.prepare('DELETE FROM scores WHERE board_id = ?').bind(id),
    env.DB.prepare(
      `INSERT INTO boards (id, event, date, alliance, label, saved_at, version) VALUES (?,?,?,?,?,?,1)
       ON CONFLICT(id) DO UPDATE SET label = COALESCE(excluded.label, boards.label),
                                     saved_at = excluded.saved_at,
                                     version = boards.version + 1`)
      .bind(id, event, date, alliance, label, now),
    snapshot
      ? env.DB.prepare(
          `INSERT INTO board_sheets (board_id, snapshot, updated_at) VALUES (?,?,?)
           ON CONFLICT(board_id) DO UPDATE SET snapshot = excluded.snapshot,
                                               updated_at = excluded.updated_at`)
          .bind(id, snapshot, now)
      : env.DB.prepare('DELETE FROM board_sheets WHERE board_id = ?').bind(id),
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
                 Number.isFinite(points) ? points : 0,
                 mode === 'replace' && r.edited ? 1 : 0));
  }
  if (!seen.size)
    return reply({ error: { code: 400, message: 'no row had both a rank and a name.' } }, 400);
  await env.DB.batch(stmts);
  const after = await env.DB.prepare('SELECT version FROM boards WHERE id = ?').bind(id).first();
  return reply({ saved: seen.size, board: id, kept: byPlace.size,
                 version: after ? after.version : 1 }, 200);
}

// One row corrected by hand, from either the old query-style route or the new path one.
async function editRow(env, reply, id, place, body) {
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
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE scores SET search=?, ingame=?, alliance=?, points=?, edited=1
        WHERE board_id=? AND place=?`)
      .bind(search, ingame, alliance, points, id, place),
    // the rows moved under the sheet, so the sheet no longer describes them
    env.DB.prepare('DELETE FROM board_sheets WHERE board_id = ?').bind(id),
    env.DB.prepare('UPDATE boards SET version = version + 1 WHERE id = ?').bind(id),
  ]);
  return reply({ updated: { place, search, ingame, alliance, points } }, 200);
}

async function handleData(seg, parts, request, env, reply) {
  if (!env.DB) return reply({ error: { code: 500,
    message: 'This Worker has no DB binding. Create the database with "wrangler d1 create '
           + 'kartz-db", put the id in wrangler.toml, and deploy again.' } }, 500);
  const url = new URL(request.url);
  const q = url.searchParams;
  const method = request.method;
  const sub = parts[1] || '';              // /boards/<id>
  const leaf = parts[2] || '';             // /boards/<id>/rows
  const readBody = () => request.json().catch(() => null);

  // ---- the roster itself -----------------------------------------------------------------
  //
  // One list, held here. It used to be a Google Sheet with this database holding only the
  // differences against it; now these rows are the record and nothing is pulled from anywhere.
  // The whole list is written at once, the way a spreadsheet is saved, so a row deleted in the
  // sheet is a row deleted here — which is why the version has to match before a save lands.
  if (seg === 'roster' && sub === 'rows' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT search, ingame, alliance, extra FROM roster ORDER BY sort, search COLLATE NOCASE').all();
    const meta = await env.DB.prepare('SELECT * FROM roster_meta WHERE id = 1').first();
    const rows = (results || []).map(r => {
      let extra = {};
      try { extra = r.extra ? JSON.parse(r.extra) : {}; } catch { extra = {}; }
      return { search: r.search, ingame: r.ingame, alliance: r.alliance, extra };
    });
    let sheet = null;
    if (meta && meta.snapshot) { try { sheet = JSON.parse(meta.snapshot); } catch { sheet = null; } }
    const j = (v, d) => { try { return JSON.parse(v || d); } catch { return JSON.parse(d); } };
    let columns = j(meta && meta.columns, '[]');
    let mapping = j(meta && meta.mapping, '{}');
    // A roster saved before columns could be in any order kept the three the app needs at the
    // front and only listed the rest. Read that as the shape it meant.
    if (!mapping.search) {
      const labels = j(meta && meta.labels, '[]');
      mapping = { search: labels[0] || 'Player', ingame: labels[1] || 'Name in video',
                  alliance: labels[2] || 'Alliance' };
      columns = [mapping.search, mapping.ingame, mapping.alliance, ...columns];
    }
    return reply({ rows, columns, mapping,
                   version: meta ? meta.version : 0, savedAt: meta ? meta.saved_at : null, sheet }, 200);
  }

  if (seg === 'roster' && sub === 'rows' && method === 'PUT') {
    const body = await readBody();
    if (!body) return reply({ error: { code: 400, message: 'a JSON body is required.' } }, 400);
    const meta = await env.DB.prepare('SELECT version FROM roster_meta WHERE id = 1').first();
    const current = meta ? meta.version : 0;
    if (body.version !== undefined && body.version !== null && Number(body.version) !== current)
      return reply({ error: { code: 409, message:
        'the roster was saved by someone else since you opened it — reload it and re-apply your edits.' },
        version: current }, 409);

    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows) return reply({ error: { code: 400, message: 'rows is required.' } }, 400);
    if (rows.length > ROSTER_MAX)
      return reply({ error: { code: 400, message: `too many rows (${rows.length}).` } }, 400);

    // A save that would empty the roster is almost always a sheet that failed to load rather
    // than a decision, so it has to be asked for by name.
    if (!rows.length && !body.allowEmpty)
      return reply({ error: { code: 400, message:
        'that would delete every player. If you meant it, clear the rows and save again.' } }, 400);

    let snapshot = null;
    if (body.sheet !== undefined && body.sheet !== null) {
      snapshot = typeof body.sheet === 'string' ? body.sheet : JSON.stringify(body.sheet);
      if (snapshot.length > SNAPSHOT_MAX)
        return reply({ error: { code: 413, message: 'the sheet snapshot is too large to store.' } }, 413);
    }

    const now = new Date().toISOString();
    const ins = env.DB.prepare(
      'INSERT INTO roster (search, ingame, alliance, extra, sort, updated_at) VALUES (?,?,?,?,?,?)');
    const stmts = [env.DB.prepare('DELETE FROM roster').bind()];
    const seen = new Set(), skipped = [];
    let n = 0;
    for (const r of rows) {
      const search = String(r.search ?? '').trim();
      if (!search) continue;                       // a row with no identity is a blank line
      // Exactly as the primary key sees it: Anubis and anubis are two players in two
      // alliances, and only a repeat of the same string would reject the batch.
      if (seen.has(search)) { skipped.push(search); continue; }
      seen.add(search);
      const extra = r.extra && typeof r.extra === 'object' ? JSON.stringify(r.extra) : null;
      stmts.push(ins.bind(search, String(r.ingame ?? '').trim() || search,
                          r.alliance ? String(r.alliance).trim() : null,
                          extra && extra !== '{}' ? extra : null, n, now));
      n++;
    }
    const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
    if (!mapping.search)
      return reply({ error: { code: 400, message:
        'the save did not say which column holds the player name.' } }, 400);
    stmts.push(env.DB.prepare(
      `UPDATE roster_meta SET columns = ?, labels = ?, mapping = ?, snapshot = ?,
              version = version + 1, saved_at = ? WHERE id = 1`)
      .bind(JSON.stringify(Array.isArray(body.columns) ? body.columns : []),
            JSON.stringify([mapping.search, mapping.ingame || '', mapping.alliance || '']),
            JSON.stringify(mapping), snapshot, now));

    // D1 allows a hundred bound parameters to a query, so a roster cannot be written as one
    // statement; it is written as one batch of them, which is applied all or not at all.
    await env.DB.batch(stmts);
    const after = await env.DB.prepare('SELECT version FROM roster_meta WHERE id = 1').first();
    return reply({ saved: n, skipped, version: after ? after.version : current + 1 }, 200);
  }

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
    const body = await readBody();
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
  if (seg === 'boards' && method === 'GET' && !sub) {
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.event, b.date, b.alliance, b.label, b.saved_at, b.version,
              COUNT(s.place) AS players, MAX(s.points) AS best,
              (bs.board_id IS NOT NULL) AS has_sheet
         FROM boards b
         LEFT JOIN scores s ON s.board_id = b.id
         LEFT JOIN board_sheets bs ON bs.board_id = b.id
        GROUP BY b.id ORDER BY b.date DESC, b.alliance ASC`).all();
    return reply({ boards: results }, 200);
  }

  // ---- one board's rows, in the order the game had them ---------------------------------
  // /board?id=… is what the old page asks; /boards/<id> is the same answer plus the sheet.
  if ((seg === 'board' && method === 'GET') || (seg === 'boards' && method === 'GET' && sub && !leaf)) {
    const id = seg === 'board' ? (q.get('id') || '') : sub;
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const { results } = await env.DB.prepare(
      `SELECT place, search, ingame, alliance, points, edited FROM scores
        WHERE board_id = ? ORDER BY place`).bind(id).all();
    let sheet = null;
    if (seg === 'boards') {
      const bs = await env.DB.prepare('SELECT snapshot, updated_at FROM board_sheets WHERE board_id = ?')
                             .bind(id).first();
      if (bs) { try { sheet = JSON.parse(bs.snapshot); } catch { sheet = null; } }
    }
    return reply({ board, rows: results, sheet, version: board.version }, 200);
  }

  // ---- save from the extractor: replaces the board, keeps hand-fixed rows ----------------
  if (seg === 'runs' && method === 'POST') {
    const body = await readBody();
    if (!body) return reply({ error: { code: 400, message: 'a JSON body is required.' } }, 400);
    return saveBoard(env, reply, { ...body, sheet: undefined, mode: 'merge' });
  }

  // ---- create a board. 409 if it exists, unless the caller says replace ------------------
  if (seg === 'boards' && method === 'POST' && !sub) {
    const body = await readBody();
    if (!body) return reply({ error: { code: 400, message: 'a JSON body is required.' } }, 400);
    const id = boardId(String(body.event || 'kartz').trim() || 'kartz',
                       String(body.date || '').trim(), String(body.alliance || '').trim());
    const existing = await env.DB.prepare('SELECT version FROM boards WHERE id = ?').bind(id).first();
    if (existing && !body.replace)
      return reply({ error: { code: 409, message: `a board already exists for ${body.alliance} on ${body.date}.` },
                     board: id, version: existing.version }, 409);
    return saveBoard(env, reply, { ...body, mode: body.replace ? 'replace' : 'merge' });
  }

  // ---- save from the sheet: rows exactly as reviewed, plus the workbook ------------------
  if (seg === 'boards' && method === 'PUT' && sub && !leaf) {
    const body = await readBody();
    if (!body) return reply({ error: { code: 400, message: 'a JSON body is required.' } }, 400);
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(sub).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    return saveBoard(env, reply, {
      event: board.event, date: board.date, alliance: board.alliance,
      label: body.label === undefined ? board.label : body.label,
      rows: body.rows, sheet: body.sheet === undefined ? null : body.sheet,
      mode: 'replace', expectVersion: body.version,
    });
  }

  // ---- relabel a board: its date, alliance, event or label, without touching the scores --
  if ((seg === 'board' && method === 'PATCH') || (seg === 'boards' && method === 'PATCH' && sub && !leaf)) {
    const body = await readBody();
    const id = seg === 'board' ? String(body && body.id || '') : sub;
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
      env.DB.prepare('UPDATE boards SET id=?, event=?, date=?, alliance=?, label=?, version=version+1 WHERE id=?')
        .bind(next, event, date, alliance, label, id),
      env.DB.prepare('UPDATE scores SET board_id=? WHERE board_id=?').bind(next, id),
      env.DB.prepare('UPDATE board_sheets SET board_id=? WHERE board_id=?').bind(next, id),
    ]);
    return reply({ board: next, renamed: next !== id }, 200);
  }

  // ---- throw a board away, scores, sheet and all ------------------------------------------
  if ((seg === 'board' && method === 'DELETE') || (seg === 'boards' && method === 'DELETE' && sub && !leaf)) {
    const id = seg === 'board' ? (q.get('id') || '') : sub;
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const n = await env.DB.prepare('SELECT COUNT(*) n FROM scores WHERE board_id = ?')
                          .bind(id).first();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM scores WHERE board_id = ?').bind(id),
      env.DB.prepare('DELETE FROM board_sheets WHERE board_id = ?').bind(id),
      env.DB.prepare('DELETE FROM boards WHERE id = ?').bind(id),
    ]);
    return reply({ deleted: id, rows: (n && n.n) || 0 }, 200);
  }

  // ---- rows of one board ------------------------------------------------------------------
  if (seg === 'boards' && sub && leaf === 'rows') {
    const id = sub;
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const place = parts[3] !== undefined ? Number(parts[3]) : NaN;

    // add or overwrite rows by rank; a person put them there, so they count as edited
    if (method === 'POST' && parts[3] === undefined) {
      const body = await readBody();
      const rows = Array.isArray(body && body.rows) ? body.rows : null;
      if (!rows || !rows.length) return reply({ error: { code: 400, message: 'rows is required.' } }, 400);
      if (rows.length > MAX_ROWS) return reply({ error: { code: 400, message: 'too many rows.' } }, 400);
      const up = env.DB.prepare(
        `INSERT INTO scores (board_id, place, search, ingame, alliance, points, edited)
         VALUES (?,?,?,?,?,?,1)
         ON CONFLICT(board_id, place) DO UPDATE SET search=excluded.search, ingame=excluded.ingame,
              alliance=excluded.alliance, points=excluded.points, edited=1`);
      const stmts = [];
      let n = 0;
      for (const r of rows) {
        const p = Number(r.place ?? r.rank), pts = Number(r.points);
        const ingame = String(r.ingame ?? r.name ?? '').trim();
        if (!Number.isFinite(p) || p <= 0 || !ingame) continue;
        stmts.push(up.bind(id, p, r.search ? String(r.search).trim() : null, ingame,
                           r.alliance ? String(r.alliance).trim() : null,
                           Number.isFinite(pts) ? pts : 0));
        n++;
      }
      if (!n) return reply({ error: { code: 400, message: 'no row had both a rank and a name.' } }, 400);
      stmts.push(env.DB.prepare('DELETE FROM board_sheets WHERE board_id = ?').bind(id));
      stmts.push(env.DB.prepare('UPDATE boards SET version = version + 1 WHERE id = ?').bind(id));
      await env.DB.batch(stmts);
      return reply({ added: n, board: id }, 200);
    }
    if (method === 'PATCH' && Number.isFinite(place)) {
      const body = await readBody();
      return editRow(env, reply, id, place, body || {});
    }
    if (method === 'DELETE' && Number.isFinite(place)) {
      const r = await env.DB.batch([
        env.DB.prepare('DELETE FROM scores WHERE board_id = ? AND place = ?').bind(id, place),
        env.DB.prepare('DELETE FROM board_sheets WHERE board_id = ?').bind(id),
        env.DB.prepare('UPDATE boards SET version = version + 1 WHERE id = ?').bind(id),
      ]);
      const changes = (r && r[0] && r[0].meta && r[0].meta.changes) || 0;
      if (!changes) return reply({ error: { code: 404, message: 'no such row' } }, 404);
      return reply({ deleted: place, board: id }, 200);
    }
    return reply({ error: { code: 405, message: 'unsupported method for rows.' } }, 405);
  }

  // ---- correct one row, and mark that a person did it (the old route) ---------------------
  if (seg === 'score' && method === 'PATCH') {
    const body = await readBody();
    return editRow(env, reply, String(body && body.board || ''), Number(body && body.place), body || {});
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

// The roster, for a spreadsheet that wants to mirror it. It is a read of this database now,
// not of a Google Sheet: the app is where the roster is maintained.
async function rosterCsv(env) {
  const { results } = await env.DB.prepare(
    'SELECT search, ingame, alliance, extra FROM roster ORDER BY sort, search COLLATE NOCASE').all();
  const meta = await env.DB.prepare('SELECT columns, labels, mapping FROM roster_meta WHERE id = 1').first();
  const j = (v, d) => { try { return JSON.parse(v || d); } catch { return JSON.parse(d); } };
  let cols = j(meta && meta.columns, '[]');
  let map = j(meta && meta.mapping, '{}');
  if (!map.search) {
    const labels = j(meta && meta.labels, '[]');
    map = { search: labels[0] || 'Player', ingame: labels[1] || 'Name in video',
            alliance: labels[2] || 'Alliance' };
    cols = [map.search, map.ingame, map.alliance, ...cols];
  }
  const body = (results || []).map(r => {
    let extra = {};
    try { extra = r.extra ? JSON.parse(r.extra) : {}; } catch { extra = {}; }
    const at = c => c === map.search ? r.search : c === map.ingame ? r.ingame
                  : c === map.alliance ? (r.alliance || '') : (extra[c] ?? '');
    return cols.map(at).map(csvCell).join(',');
  });
  const head = cols;
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
    const parts = new URL(request.url).pathname.replace(/^\/+/, '').replace(/^api\/+/, '')
      .split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
    const seg = parts[0];
    if (['runs', 'boards', 'board', 'score', 'month', 'player', 'all', 'roster'].includes(seg)) {
      try {
        const out = await handleData(seg, parts, request, env, reply);
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
