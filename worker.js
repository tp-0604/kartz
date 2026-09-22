/**
 * Kartz — the key holder.
 *
 * One job now: keep the model key out of the spreadsheet. The dialog is a page Google serves
 * from googleusercontent.com, and a page cannot hold a secret — anyone who can open the add-on
 * could read it. So the page sends frames here, this Worker adds the key, and the model answers
 * back through it. The same door answers questions about a tab.
 *
 * There is no database and no account system. Who may do what is decided by Google, in the
 * sharing settings of the spreadsheet the add-on is bound to: if you can open the sheet you can
 * open the dialog, and the dialog is handed the shared phrase by Apps Script when it starts.
 * The phrase is the only thing this Worker checks, because it is the only thing it can check.
 *
 *   wrangler deploy
 *   wrangler secret put GEMINI_KEY      <- required: reading a recording
 *   wrangler secret put SHARED_PASS     <- required: the phrase the spreadsheet brings
 *   wrangler secret put ANTHROPIC_API_KEY | OPENAI_API_KEY   <- optional: asking about a tab
 */
import { HttpError } from './worker/util.js';
import { ask, aiStatus } from './worker/ai/index.js';

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/models';

// Where a request may come from. The add-on's page is served by Google from a subdomain of
// googleusercontent.com that changes, so the host is matched rather than listed. Apps Script's
// own UrlFetchApp sends no Origin at all, which is fine: the phrase is what actually decides.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',                    // npm run dev in web/
  'http://localhost:8788',                    // tools/serve-dialog.mjs
];
const ALLOWED_HOSTS = /(^|\.)googleusercontent\.com$/;

function originOk(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try { return ALLOWED_HOSTS.test(new URL(origin).hostname); } catch { return false; }
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-kartz-pass',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

/**
 * Cloudflare's own models, reached through the AI binding.
 *
 * They are deliberately not reachable from the page: the Workers AI REST API answers a CORS
 * preflight with 405 and sets no allow-origin header, so a browser cannot call it however the
 * request is shaped. Running it here sidesteps that and keeps the account token out of the
 * browser at the same time. The page always speaks the Gemini request shape, so translate in
 * both directions rather than teaching it a third dialect.
 */
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);
    const reply = (body, status) => new Response(JSON.stringify(body),
      { status, headers: { ...cors, 'content-type': 'application/json' } });

    // The preflight cannot carry the phrase — a browser sends it before the real request and
    // without its headers — so this one is decided on the origin alone. The request that
    // follows it still has to bring the phrase.
    if (request.method === 'OPTIONS') {
      return new Response(null, originOk(origin)
        ? { status: 204, headers: cors }
        : { status: 403 });
    }

    // The phrase, and nothing else. An Origin header proves nothing — it is trivially forged —
    // and without a gate of some kind a deployment with a model key is an open AI proxy for
    // whoever finds the URL.
    if (!env.SHARED_PASS) {
      return reply({ error: { code: 501, message:
        'this Worker has no SHARED_PASS secret set, so it will not answer. Set one with: '
        + 'wrangler secret put SHARED_PASS — then put the same phrase in Kartz → Settings.' } }, 501);
    }
    if (request.headers.get('x-kartz-pass') !== env.SHARED_PASS) {
      return reply({ error: { code: 403, message:
        'wrong shared phrase. Put the phrase this Worker was given into Kartz → Settings.' } }, 403);
    }

    // `/api/ai/ask` and `/ai/ask` are the same route: the page is configured with the Worker's
    // address and nothing else, and both spellings of it are easy to end up with.
    const path = url.pathname.replace(/^\/+/, '').replace(/^api\/+/, '');
    const parts = path.split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });

    if (parts[0] === 'ai') {
      try {
        if (parts[1] === 'status' && request.method === 'GET') return reply(aiStatus(env), 200);
        if (parts[1] === 'ask' && request.method === 'POST') {
          const body = await request.json().catch(() => null);
          if (!body) throw new HttpError(400, 'a JSON body is required.');
          return reply(await ask(env, body), 200);
        }
        return reply({ error: { code: 404, message: 'no such route' } }, 404);
      } catch (e) {
        const status = e instanceof HttpError ? e.status
          : (e && e.status >= 400 && e.status < 600 ? e.status : 500);
        return reply({ error: { code: status, message: String((e && e.message) || e) } }, status);
      }
    }

    // Everything else is a model call by name — reading a recording — which is always a POST.
    if (request.method !== 'POST') return reply({ error: { code: 405, message: 'POST only' } }, 405);

    const model = path;
    const isCf = model.startsWith('@cf/');
    if (!(isCf ? /^@cf\/[a-zA-Z0-9._/-]{1,80}$/ : /^[a-zA-Z0-9.-]{1,64}$/).test(model))
      return reply({ error: { code: 400, message: 'Bad model name.' } }, 400);

    // 501, not 500: the page retries a 500 for two minutes because a 500 is usually a model
    // having a bad afternoon. A missing key is not going to start working, so it must not look
    // like one that might.
    if (!isCf && !env.GEMINI_KEY)
      return reply({ error: { code: 501, message:
        'this Worker has no GEMINI_KEY secret set, so it cannot read a recording. '
        + 'Set one with: wrangler secret put GEMINI_KEY' } }, 501);

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
