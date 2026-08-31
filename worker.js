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

async function handleData(seg, request, env, reply) {
  if (!env.DB) return reply({ error: { code: 500,
    message: 'This Worker has no DB binding. Create the database with "wrangler d1 create '
           + 'kartz-db", put the id in wrangler.toml, and deploy again.' } }, 500);
  const url = new URL(request.url);

  // Every run recorded, newest first — the index of what the database holds.
  if (seg === 'runs' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT date, alliance, COUNT(*) AS players, MAX(points) AS best
         FROM scores GROUP BY run_id ORDER BY date DESC, alliance ASC`).all();
    return reply({ runs: results }, 200);
  }

  // Save one alliance's board for one day.
  if (seg === 'runs' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const date = String(body && body.date || '').trim();
    const alliance = String(body && body.alliance || '').trim();
    const rows = Array.isArray(body && body.rows) ? body.rows : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return reply({ error: { code: 400, message: 'date must be YYYY-MM-DD.' } }, 400);
    if (!alliance) return reply({ error: { code: 400, message: 'alliance is required.' } }, 400);
    if (!rows || !rows.length)
      return reply({ error: { code: 400, message: 'rows is required.' } }, 400);
    if (rows.length > MAX_ROWS)
      return reply({ error: { code: 400, message: `too many rows (${rows.length}).` } }, 400);

    const runId = date + '|' + alliance;
    const ins = env.DB.prepare(
      `INSERT INTO scores (run_id, date, alliance, place, search, ingame, points)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const stmts = [env.DB.prepare('DELETE FROM scores WHERE run_id = ?').bind(runId)];
    const seen = new Set();
    for (const r of rows) {
      const place = Number(r.place ?? r.rank);
      const points = Number(r.points);
      const ingame = String(r.ingame ?? r.name ?? '').trim();
      if (!Number.isFinite(place) || place <= 0 || !ingame) continue;
      if (seen.has(place)) continue;        // the primary key would reject the whole batch
      seen.add(place);
      stmts.push(ins.bind(runId, date, alliance, place,
                          r.search ? String(r.search).trim() : null,
                          ingame, Number.isFinite(points) ? points : 0));
    }
    await env.DB.batch(stmts);
    return reply({ saved: stmts.length - 1, run: runId, replaced: true }, 200);
  }

  // One run's rows, in the order the game had them.
  if (seg === 'scores' && request.method === 'GET') {
    const date = url.searchParams.get('date') || '';
    const alliance = url.searchParams.get('alliance') || '';
    const { results } = await env.DB.prepare(
      `SELECT place, search, ingame, points FROM scores
        WHERE run_id = ? ORDER BY place`).bind(date + '|' + alliance).all();
    return reply({ rows: results }, 200);
  }

  // Everything one player has ever scored, oldest first. Looked up by the roster name rather
  // than the drawn one: the drawn name changes whenever they feel like it.
  if (seg === 'player' && request.method === 'GET') {
    const who = url.searchParams.get('search') || '';
    if (!who) return reply({ error: { code: 400, message: 'search is required.' } }, 400);
    const { results } = await env.DB.prepare(
      `SELECT date, alliance, place, ingame, points FROM scores
        WHERE search = ? ORDER BY date ASC, alliance ASC`).bind(who).all();
    return reply({ history: results }, 200);
  }

  // Everything, for the spreadsheet view and for getting the data back out again.
  if (seg === 'all' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT date, alliance, place, search, ingame, points FROM scores
        ORDER BY date DESC, alliance ASC, place ASC`).all();
    return reply({ rows: results }, 200);
  }

  return null;                              // not a data route; fall through to the model
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
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
    if (['runs', 'scores', 'player', 'all'].includes(seg)) {
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
