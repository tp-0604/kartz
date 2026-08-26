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
 * Deploy (free tier, no card):
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler deploy
 *   3. wrangler secret put GEMINI_KEY        <- paste your key at the prompt
 *   4. wrangler secret put SHARED_PASS       <- any phrase you give your officers
 *   5. Set ALLOWED_ORIGINS below to your Pages URL, then deploy again.
 *
 * The key is then only ever in Cloudflare. Your officers need the site and the phrase.
 */

// Only these origins may call the Worker. Keep the list tight: this, plus the shared
// phrase, is the whole of the access control.
const ALLOWED_ORIGINS = [
  'https://YOURNAME.github.io',
  'http://localhost:8731',
];

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/models';

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
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403,
                                  headers: allowed ? corsHeaders(origin) : {} });
    }
    if (!allowed) return new Response('origin not allowed', { status: 403 });

    const cors = corsHeaders(origin);
    const reply = (body, status) => new Response(JSON.stringify(body),
      { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (request.method !== 'POST') return reply({ error: 'POST only' }, 405);

    // A public page plus a public Worker is a public API unless something gates it.
    if (env.SHARED_PASS && request.headers.get('x-kartz-pass') !== env.SHARED_PASS)
      return reply({ error: { code: 401, message: 'Wrong or missing shared phrase.' } }, 401);

    if (!env.GEMINI_KEY)
      return reply({ error: { code: 500, message: 'Worker has no GEMINI_KEY secret set.' } }, 500);

    // Path is /<model>. Constrain it so this cannot be aimed at arbitrary Google endpoints.
    const model = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    if (!/^[a-zA-Z0-9.\-]{1,64}$/.test(model))
      return reply({ error: { code: 400, message: 'Bad model name.' } }, 400);

    // Frames are large; cap the body so a stray caller cannot post something enormous.
    const body = await request.text();
    if (body.length > 25 * 1024 * 1024)
      return reply({ error: { code: 413, message: 'Request too large.' } }, 413);

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
