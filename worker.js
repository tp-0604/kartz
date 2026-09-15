/**
 * Kartz — the API, and the key holder.
 *
 * Two jobs in one deployment. It keeps the model key off the page: a static site cannot hold a
 * secret, so the browser talks to this and this talks to the model. And it owns the database:
 * the boards, the roster, the columns somebody added, the activity trail, and the controlled
 * tools the analytics layer is allowed to run against D1.
 *
 * The routes live in worker/. This file is the door: who may knock, what the path means, and
 * what to do with anything that is not a data route — which is a model call.
 *
 *   wrangler deploy
 *   wrangler secret put GEMINI_KEY      <- required for the extractor
 *   wrangler secret put SHARED_PASS     <- the phrase, when the page is hosted elsewhere
 *   wrangler secret put ANTHROPIC_API_KEY | OPENAI_API_KEY   <- optional: the analyst
 */
import { HttpError, str, toInt } from './worker/util.js';
import * as Data from './worker/datasets.js';
import * as Boards from './worker/boards.js';
import * as Views from './worker/views.js';
import { handleCsv } from './worker/csv.js';
import { ask, aiStatus } from './worker/ai/index.js';

// Extra origins allowed to call this, for when the page is hosted somewhere else — GitHub
// Pages, say. Anything served from this same deployment is allowed automatically.
const ALLOWED_ORIGINS = [
  'http://localhost:8731',
  'http://localhost:5173',              // `npm run dev` in web/ (it proxies /api, but just in case)
  'https://tp-0604.github.io',          // the React build on GitHub Pages
];

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/models';

// Cloudflare's own models can be reached from inside a Worker through the AI binding. They are
// deliberately NOT reachable from the page: the Workers AI REST API answers a CORS preflight
// with 405 and sets no allow-origin header on the response either, so a static site cannot call
// it however the request is shaped. Running it here sidesteps that and keeps the account token
// out of the browser at the same time.
//
// The page always speaks the Gemini request shape, so translate in both directions rather than
// teaching the page a third dialect.
async function runWorkersAI(env, model, body) {
  if (!env.AI) throw new Error('This Worker has no AI binding. Add [ai]\nbinding = "AI" to wrangler.toml.');
  const parts = body?.contents?.[0]?.parts || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('\n');
  const images = parts.filter(p => p.inline_data).map(p => p.inline_data.data);
  const content = [
    ...images.map(d => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + d } })),
    { type: 'text', text },
  ];
  const out = await env.AI.run(model, { messages: [{ role: 'user', content }], max_tokens: 4096, temperature: 0 });
  const reply = out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content ?? '';
  return { candidates: [{ content: { parts: [{ text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] } }] };
}

// ---------------------------------------------------------------------------------------
// The data routes
// ---------------------------------------------------------------------------------------
const DATA_SEGMENTS = new Set([
  'datasets', 'runs', 'commit', 'boards', 'board', 'score', 'month', 'player', 'all',
  'roster', 'activity', 'views', 'ai',
]);

async function handleData(seg, parts, request, env, reply) {
  if (!env.DB) return reply({ error: { code: 500,
    message: 'This Worker has no DB binding. Create the database with "wrangler d1 create '
           + 'kartz-db", put the id in wrangler.toml, and deploy again.' } }, 500);
  const url = new URL(request.url);
  const q = url.searchParams;
  const method = request.method;
  const sub = parts[1] || '';
  const leaf = parts[2] || '';
  const body = async () => {
    const j = await request.json().catch(() => null);
    if (!j) throw new HttpError(400, 'a JSON body is required.');
    return j;
  };

  // ---- the analyst ----------------------------------------------------------------------
  if (seg === 'ai') {
    if (sub === 'status' && method === 'GET') return reply(aiStatus(env), 200);
    if (sub === 'ask' && method === 'POST') return reply(await ask(env, await body()), 200);
    return null;
  }

  // ---- datasets: what the workspace opens and edits ---------------------------------------
  if (seg === 'datasets' && method === 'GET' && !sub) return reply(await Data.listDatasets(env), 200);
  if (seg === 'datasets' && method === 'GET' && sub && !leaf)
    return reply(await Data.readDataset(env, sub), 200);
  if (seg === 'datasets' && method === 'POST' && sub && leaf === 'ops')
    return reply(await Data.applyOps(env, sub, await body()), 200);

  // ---- the roster, read and replaced whole --------------------------------------------------
  // The extractor mirrors this into the browser so a bad connection cannot stop a run, and an
  // import replaces the list in one write. Editing a player is a dataset op like any other.
  if (seg === 'roster' && sub === 'rows' && method === 'GET') {
    const out = await Data.readDataset(env, 'roster');
    const rows = out.rows.map(r => {
      const extra = {};
      for (const c of out.columns) if (c.role === 'extra' && r[c.key]) extra[c.header] = r[c.key];
      return { id: r.id, search: r.search, ingame: r.ingame, alliance: r.alliance, extra };
    });
    return reply({ rows, columns: out.columns.map(c => c.header), mapping: out.dataset.mapping,
                   version: out.version, savedAt: out.dataset.savedAt }, 200);
  }
  if (seg === 'roster' && sub === 'rows' && method === 'PUT')
    return reply(await Data.replaceRoster(env, await body()), 200);

  // The single page in public/ still asks for /api/roster: the old shape, where a Google Sheet
  // was the roster and this database held only the differences against it. That stopped being
  // true two versions ago. Saying so is better than falling through to the model proxy, which
  // would go and ask Google for a model called "roster".
  if (seg === 'roster')
    return reply({ error: { code: 410, message:
      'the roster is no longer a set of differences against a Google Sheet — it is these rows. '
      + 'Read it at /api/roster/rows, or open it in the app.' } }, 410);

  // ---- boards --------------------------------------------------------------------------------
  if (seg === 'boards' && method === 'GET' && !sub) {
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.event, b.date, b.alliance, b.label, b.saved_at, b.version,
              COUNT(s.id) AS players, MAX(s.points) AS best
         FROM boards b LEFT JOIN scores s ON s.board_id = b.id
        GROUP BY b.id ORDER BY b.date DESC, b.alliance ASC`).all();
    return reply({ boards: results || [] }, 200);
  }

  if ((seg === 'board' && method === 'GET') || (seg === 'boards' && method === 'GET' && sub && !leaf)) {
    const id = seg === 'board' ? (q.get('id') || '') : sub;
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    if (seg === 'board') {
      const { results } = await env.DB.prepare(
        'SELECT place, search, ingame, alliance, points, edited FROM scores WHERE board_id = ? ORDER BY place')
        .bind(id).all();
      return reply({ board, rows: results || [], version: board.version }, 200);
    }
    const out = await Data.readDataset(env, 'board:' + id);
    return reply({ board, rows: out.rows, columns: out.columns, version: out.version }, 200);
  }

  // The extractor's own save: replaces the board, keeps rows somebody corrected by hand.
  if (seg === 'runs' && method === 'POST')
    return reply(await Boards.saveBoard(env, { ...(await body()), mode: 'merge' }), 200);
  if (seg === 'runs' && method === 'GET')
    return reply(await Boards.listRuns(env, toInt(q.get('limit'), 60)), 200);

  // Extraction → data, with a preview first.
  if (seg === 'commit' && method === 'POST')
    return reply(await Boards.commitExtraction(env, await body()), 200);

  if (seg === 'boards' && method === 'POST' && !sub) {
    const b = await body();
    const id = Boards.boardId(str(b.event) || 'kartz', str(b.date), str(b.alliance));
    const existing = await env.DB.prepare('SELECT version FROM boards WHERE id = ?').bind(id).first();
    if (existing && !b.replace)
      return reply({ error: { code: 409, message: `a board already exists for ${b.alliance} on ${b.date}.` },
                     board: id, version: existing.version }, 409);
    return reply(await Boards.saveBoard(env, { ...b, mode: b.replace ? 'replace' : 'merge',
                                              rows: Array.isArray(b.rows) ? b.rows : [],
                                              allowEmpty: !!b.allowEmpty }), 200);
  }

  if (seg === 'boards' && method === 'PUT' && sub && !leaf) {
    const b = await body();
    const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(sub).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    return reply(await Boards.saveBoard(env, {
      event: board.event, date: board.date, alliance: board.alliance,
      label: b.label === undefined ? board.label : b.label,
      rows: b.rows, columns: b.columns, mode: 'replace', expectVersion: b.version,
    }), 200);
  }

  if ((seg === 'board' && method === 'PATCH') || (seg === 'boards' && method === 'PATCH' && sub && !leaf)) {
    const b = await body();
    return reply(await Boards.patchBoard(env, seg === 'board' ? str(b.id) : sub, b), 200);
  }
  if ((seg === 'board' && method === 'DELETE') || (seg === 'boards' && method === 'DELETE' && sub && !leaf))
    return reply(await Boards.deleteBoard(env, seg === 'board' ? (q.get('id') || '') : sub), 200);

  if (seg === 'boards' && sub && leaf === 'rows') {
    const board = await env.DB.prepare('SELECT id FROM boards WHERE id = ?').bind(sub).first();
    if (!board) return reply({ error: { code: 404, message: 'no such board' } }, 404);
    const place = parts[3] !== undefined ? Number(parts[3]) : NaN;
    if (method === 'POST' && parts[3] === undefined)
      return reply(await Boards.addRows(env, sub, (await body()).rows), 200);
    if (method === 'PATCH' && Number.isFinite(place))
      return reply(await Boards.editRow(env, sub, place, await body()), 200);
    if (method === 'DELETE' && Number.isFinite(place))
      return reply(await Boards.deleteRowAt(env, sub, place), 200);
    return reply({ error: { code: 405, message: 'unsupported method for rows.' } }, 405);
  }

  if (seg === 'score' && method === 'PATCH') {
    const b = await body();
    return reply(await Boards.editRow(env, str(b.board), Number(b.place), b), 200);
  }

  // ---- reading across boards ------------------------------------------------------------------
  if (seg === 'month' && method === 'GET')
    return reply(await Views.monthView(env, { month: q.get('month') || '', alliance: q.get('alliance') || '',
                                              event: q.get('event') || 'kartz' }), 200);
  if (seg === 'player' && method === 'GET') return reply(await Views.playerView(env, q.get('search') || ''), 200);
  if (seg === 'all' && method === 'GET') return reply(await Views.allRows(env, toInt(q.get('limit'), 20000)), 200);
  if (seg === 'activity' && method === 'GET') return reply(await Views.activity(env, toInt(q.get('limit'), 80)), 200);

  if (seg === 'views' && method === 'GET') return reply(await Views.listViews(env, q.get('dataset') || ''), 200);
  if (seg === 'views' && method === 'POST') return reply(await Views.saveView(env, await body()), 200);
  if (seg === 'views' && method === 'DELETE' && sub) return reply(await Views.deleteView(env, sub), 200);

  return null;                              // not a data route; fall through to the model
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

    // Anything that is not the API is the site itself. Static files are normally served before
    // this script ever runs; this covers the rest, so one deployment answers for both halves
    // and there is no second origin to authorise.
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
    // the workbook, and rotated without anyone re-authorising anything.
    if (url.pathname.replace(/^\/+/, '').replace(/^api\/+/, '').split('/')[0] === 'csv') {
      const token = request.headers.get('x-kartz-token') || url.searchParams.get('token') || '';
      const browser = !!request.headers.get('Origin') || !!request.headers.get('Sec-Fetch-Site');
      const ok = (env.SHEET_TOKEN && token === env.SHEET_TOKEN)
              || (browser && (!request.headers.get('Origin')
                   || request.headers.get('Origin') === url.origin
                   || ALLOWED_ORIGINS.includes(request.headers.get('Origin'))));
      if (!ok) return new Response('a token is required for this route', { status: 403 });
      try { return await handleCsv(request, env); }
      catch (e) { return new Response('error: ' + String((e && e.message) || e), { status: 500 }); }
    }

    const origin = request.headers.get('Origin') || '';
    const knownOrigin = !!origin && (origin === url.origin || ALLOWED_ORIGINS.includes(origin));
    // A request with no Origin at all is not a browser — curl, or a script. Those are fine, but
    // only when they bring the shared phrase: otherwise an unconfigured deployment is an open AI
    // proxy for anyone who finds the URL. An origin header proves nothing on its own (it is
    // trivially forged), so the phrase is the real gate.
    const hasPass = !!env.SHARED_PASS && request.headers.get('x-kartz-pass') === env.SHARED_PASS;
    // A same-origin GET carries no Origin header at all — browsers only send one for POST and
    // the other unsafe methods. Sec-Fetch-Site is set by the browser and cannot be written by
    // script, so it says what Origin cannot here.
    const sameSite = request.headers.get('Sec-Fetch-Site') === 'same-origin';
    const allowed = knownOrigin || sameSite || hasPass;

    if (request.method === 'OPTIONS')
      return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? corsHeaders(origin) : {} });
    if (!allowed) return new Response('origin not allowed', { status: 403 });

    const cors = corsHeaders(origin);
    const reply = (body, status) => new Response(JSON.stringify(body),
      { status, headers: { ...cors, 'content-type': 'application/json' } });

    // The data routes come first: "runs" and "player" would otherwise pass for model names and
    // be forwarded to Google.
    const parts = url.pathname.replace(/^\/+/, '').replace(/^api\/+/, '')
      .split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
    const seg = parts[0];
    if (DATA_SEGMENTS.has(seg)) {
      try {
        const out = await handleData(seg, parts, request, env, reply);
        if (out) return out;
      } catch (e) {
        if (e instanceof HttpError)
          return reply({ error: { code: e.status, message: e.message }, ...e.extra }, e.status);
        const status = e && e.status >= 400 && e.status < 600 ? e.status : 500;
        return reply({ error: { code: status, message: String((e && e.message) || e) } }, status);
      }
    }

    // Everything past this point is a model call, which is always a POST.
    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);

    // No separate phrase check here. The gate above already decided: a request either came from
    // an origin this deployment recognises — the site itself — or it brought the shared phrase.

    const model = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/^api\/+/, ''));
    const isCf = model.startsWith('@cf/');
    if (!(isCf ? /^@cf\/[a-zA-Z0-9._/-]{1,80}$/ : /^[a-zA-Z0-9.-]{1,64}$/).test(model))
      return reply({ error: { code: 400, message: 'Bad model name.' } }, 400);

    if (!isCf && !env.GEMINI_KEY)
      return reply({ error: { code: 500, message: 'Worker has no GEMINI_KEY secret set.' } }, 500);

    // Frames are large; cap the body so a stray caller cannot post something enormous.
    const payload = await request.text();
    if (payload.length > 25 * 1024 * 1024)
      return reply({ error: { code: 413, message: 'Request too large.' } }, 413);

    if (isCf) {
      try { return reply(await runWorkersAI(env, model, JSON.parse(payload)), 200); }
      catch (e) {
        // surface it as a normal upstream failure so the page's fallback logic still applies
        return reply({ error: { code: 502, message: String((e && e.message) || e) } }, 502);
      }
    }

    const upstream = await fetch(
      `${UPSTREAM}/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_KEY)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });

    // Pass the status through untouched: the page relies on seeing 429 and 503 so it can move
    // down its fallback chain.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'content-type': upstream.headers.get('content-type') || 'application/json' },
    });
  },
};
