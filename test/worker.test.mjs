// The Worker, which is now one thing: a door with a phrase on it. What is tested is the door —
// who gets in, who does not, and that a model key is never handed to either.
import worker from '../worker.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const PASS = 'open sesame';
const env = { SHARED_PASS: PASS, GEMINI_KEY: 'k', ANTHROPIC_API_KEY: 'a' };
const SHEET = 'https://n-abc123.googleusercontent.com';

const call = (path, opts = {}, e = env) => worker.fetch(new Request('https://kartz.workers.dev' + path, {
  method: opts.method || 'GET',
  headers: { ...(opts.origin ? { Origin: opts.origin } : {}),
             ...(opts.pass === null ? {} : { 'x-kartz-pass': opts.pass || PASS }),
             ...(opts.body ? { 'content-type': 'application/json' } : {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined,
}), e);

const body = async res => await res.json().catch(() => ({}));

console.log('\n# the preflight');
let res = await call('/api/ai/ask', { method: 'OPTIONS', origin: SHEET, pass: null });
ok('a page Google serves the add-on from may ask', res.status === 204);
ok('and is told it may send the phrase',
   (res.headers.get('access-control-allow-headers') || '').includes('x-kartz-pass'));
ok('the answer is for that origin only, and says so',
   res.headers.get('access-control-allow-origin') === SHEET && res.headers.get('vary') === 'Origin');

res = await call('/api/ai/ask', { method: 'OPTIONS', origin: 'https://not-google.example', pass: null });
ok('anywhere else is refused before it can try', res.status === 403);

console.log('\n# the phrase');
res = await call('/ai/status', { origin: SHEET, pass: null });
ok('no phrase, no answer — not even the status', res.status === 403);
res = await call('/ai/status', { origin: SHEET, pass: 'not it' });
ok('the wrong phrase is refused', res.status === 403);
ok('and the refusal says where to fix it', (await body(res)).error.message.includes('Settings'));

res = await call('/ai/status', {}, { GEMINI_KEY: 'k' });
ok('a Worker with no phrase set refuses everyone rather than proxying for anyone',
   res.status === 501 && (await body(res)).error.message.includes('SHARED_PASS'));

console.log('\n# the routes');
res = await call('/ai/status', { origin: SHEET });
let out = await body(res);
ok('the status answers with the phrase', res.status === 200 && out.available === true, out);
ok('and never with the key itself',
   !JSON.stringify(out).includes('k') || !JSON.stringify(out).match(/"(GEMINI_KEY|key)"/), out);

ok('both spellings of the path reach the same route',
   (await call('/api/ai/status', { origin: SHEET })).status === 200);

res = await call('/ai/ask', { method: 'POST', origin: SHEET, body: { question: '' } });
ok('a question with nothing in it is a 400, not a model call', res.status === 400, await body(res));

res = await call('/ai/ask', { method: 'POST', origin: SHEET,
                              body: { question: 'who?', sheet: { headers: ['a'], rows: [] } } });
ok('a tab with no rows is a 400 too — there is nothing to answer from', res.status === 400, await body(res));

res = await call('/ai/nonsense', { origin: SHEET });
ok('an unknown ai route is a 404', res.status === 404);

console.log('\n# reading a recording');
res = await call('/gemini-3.5-flash', { origin: SHEET });
ok('a model call has to be a POST', res.status === 405);

res = await call('/../etc/passwd', { method: 'POST', origin: SHEET, body: {} });
ok('a model name that is not one is refused', res.status === 400, await body(res));

res = await call('/gemini-3.5-flash', { method: 'POST', origin: SHEET, body: {} },
                 { SHARED_PASS: PASS });
ok('with no key, a 501 — a 500 would have the page retrying for two minutes',
   res.status === 501 && (await body(res)).error.message.includes('GEMINI_KEY'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
