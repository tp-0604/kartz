// What the analyst does when the model provider is busy, rate-limited or refusing — with the
// provider's answers faked, so it runs with no key and no network.
import { chat } from '../worker/ai/providers.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const env = { GEMINI_KEY: 'test', AI_RETRY_MS: 5 };
const answer = text => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }],
                                               usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } } });
const error = (status, message) => ({ status, body: { error: { code: status, message, status: 'X' } } });
const BUSY = 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.';

// Each call takes the next reply in the script, and says which model it was sent to.
function script(replies) {
  const models = [];
  globalThis.fetch = async url => {
    models.push(String(url).match(/models\/([^:]+):/)[1]);
    const r = replies.shift() || error(500, 'script ran out');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return models;
}
const ask = () => chat(env, { system: 's', messages: [{ role: 'user', content: 'q' }] });

console.log('\n# a busy provider');
let seen = script([error(503, BUSY), answer('second try')]);
let out = await ask();
ok('a busy model is tried once more, and answers', out.text === 'second try' && seen.join() === 'gemini-3.5-flash,gemini-3.5-flash', seen);
ok('what it cost is still counted', out.usage && out.usage.input === 10, out.usage);

seen = script([error(503, BUSY), error(503, BUSY), answer('from the small one')]);
out = await ask();
ok('still busy, the smaller model answers instead',
   out.text === 'from the small one' && out.model === 'gemini-3.5-flash-lite' && seen.length === 3, { seen, model: out.model });

seen = script([error(503, BUSY), error(503, BUSY), error(503, BUSY), error(503, BUSY)]);
let threw = null;
try { await ask(); } catch (e) { threw = e; }
ok('everything busy says so plainly', !!threw && threw.status === 503 && /^The AI is busy right now/.test(threw.message)
   && seen.length === 4, { message: threw && threw.message, seen });

console.log('\n# a spent quota, and a bad key');
seen = script([error(429, 'Resource has been exhausted (e.g. check quota).'), answer('lite had quota')]);
out = await ask();
ok('a spent quota moves to the next model without waiting on the first',
   out.text === 'lite had quota' && seen.join() === 'gemini-3.5-flash,gemini-3.5-flash-lite', seen);

seen = script([error(401, 'API key not valid.'), answer('never reached')]);
threw = null;
try { await ask(); } catch (e) { threw = e; }
ok('a bad key is not retried anywhere', !!threw && threw.status === 401 && seen.length === 1, { seen, threw: threw && threw.message });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
