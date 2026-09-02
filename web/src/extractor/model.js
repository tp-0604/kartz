// The model call: rate gate, batching, fallback and the JSON salvage. Lifted from the
// single-file page. Changes: progress and log go through ctx, the roster is a parameter,
// and the request goes through the API module so it carries the shared phrase when the
// page is hosted away from the Worker.
import { ctx } from './context.js';
import { MODEL, FALLBACKS, batchSize } from './config.js';
import { buildPrompt, rosterSheet } from './prompt.js';
import { apiUrl, apiHeaders } from '../services/api.js';

// The free tier meters requests per minute — fifteen a minute for this model — not per day.
// That never bit while a run was six requests, but slicing each frame into strips triples the
// number of images and so triples the batches, and eighteen requests leaving at once is well
// over the line. They go through a gate instead, twelve to the minute, and anything refused
// even so is waited out by withFallback rather than dropped.
// Requests were the limit that bit while a run was six of them. Slicing frames into bands
// made images the dominant cost, and the allowance that binds now is tokens: 250,000 a minute,
// against roughly 330,000 for a single run at 96 frames. An image is charged at a flat ~1090
// tokens whatever its size, so 288 of them come to about 314,000 before the prompt is counted.
//
// The gate therefore meters both, and a request waits until the rolling minute has room for
// its own estimated cost. A run simply takes as many minutes as it needs, rather than failing
// partway through and throwing away the batches already paid for.
const TPM = 240000;                    // the published limit is 250,000
// What a single run is allowed to spend, leaving the rest of the minute's allowance as margin
// for a roster that keeps growing and for the estimate being an estimate.
const TPM_TARGET = 225000;
// Roster names in exotic scripts tokenise badly: the prompt measures 13,320 characters and
// 5,657 tokens, which is 2.35 to the token rather than the usual 4. Estimating at 4 put the
// spend a third under what it really was, which is the wrong direction to be wrong in here.
const CHARS_PER_TOKEN = 2.3;
const IMG_TOKENS = 1100;               // measured: 1092 for a frame, and flat in its dimensions

// A budget for the minute, not a speed limit.
//
// The previous version spaced departures evenly: it took the spend of a request, divided the
// minute by it, and left that long between each. That holds the average rate inside the
// allowance, but it also means a run that would fit in one burst is dribbled out anyway — six
// requests twelve seconds apart put the last one on the wire at sixty-one seconds, so every
// run took over a minute however quickly the model answered.
//
// What the allowance actually says is that a rolling minute may carry 250,000 tokens. A whole
// run is a little under that, so it can go at once and the minute is simply spent. Requests
// wait only when the window is genuinely full.
//
// Charging the window before a request leaves is what makes it safe, and refunding a request
// that failed is what makes it correct: a 429 costs nothing, and an earlier attempt at this
// left those charges standing, so retries double-counted and the run wedged. The lease handed
// back here settles the charge against what the response says was really spent, or cancels it.
const rateGate = (() => {
  const win = [];                      // { t, tokens } for the last minute
  return async (tokens = 0) => {
    for (;;) {
      const now = Date.now();
      while (win.length && now - win[0].t > 60000) win.shift();
      const used = win.reduce((n, e) => n + e.tokens, 0);
      if (!win.length || used + tokens <= TPM) {
        const entry = { t: now, tokens };
        win.push(entry);
        return {
          settle: actual => { if (actual > 0) entry.tokens = actual; },
          refund: () => { entry.tokens = 0; },
        };
      }
      ctx.log(`waiting for the per-minute token allowance…`);
      await new Promise(r => setTimeout(r, 1000));
    }
  };
})();

async function callModel(frames, roster, sheetOn = true) {
  const sheet = sheetOn ? rosterSheet(roster) : null;
  const batches = [];
  const B = batchSize(frames.length);
  for (let i = 0; i < frames.length; i += B) batches.push(frames.slice(i, i + B));
  let done = 0;
  const switched = new Set();
  const promptTokens = Math.ceil(buildPrompt(roster, false).length / CHARS_PER_TOKEN);
  const one = async b => {
    const est = (b.length + (sheet ? 1 : 0)) * IMG_TOKENS + promptTokens;
    const rows = await withFallback(async m => {
                                      const lease = await rateGate(est);
                                      try {
                                        const got = await callProxy(sheet ? [sheet, ...b] : b, m, roster);
                                        lease.settle(callProxy.lastUsage);
                                        return got;
                                      } catch (e) { lease.refund(); throw e; }
                                    },
                                    modelChain(), m => switched.add(m), true);
    done++; ctx.progress(0.5 + 0.5 * done / batches.length);
    ctx.log(`read ${done} of ${batches.length} batches…`
        + (switched.size ? `  (fell back to ${[...switched].join(', ')})` : ''));
    return rows;
  };
  return (await Promise.all(batches.map(one))).flat();
}

const modelChain = () => [MODEL, ...FALLBACKS.filter(m => m !== MODEL)];
const isBusy = e => /\b(429|500|502|503|504)\b/.test(e.message);

// How long the server asked us to wait, in seconds, or 0 if it did not say. Groq answers
// with a retry-after header and often names the delay in the message body too.
function waitHint(e) {
  const h = (e.message.match(/retry-after ([\d.]+)/) || [])[1];
  if (h) return Math.min(90, Math.ceil(+h));
  // Gemini words it "Please retry in 57.598635818s", which the pattern below did not match,
  // so a wait the server had explicitly asked for was read as no hint at all and the batch
  // was abandoned instead of retried.
  const retry = (e.message.match(/retry in ([\d.]+)\s*s/i) || [])[1];
  if (retry) return Math.min(90, Math.ceil(+retry));
  const inline = (e.message.match(/try again in ([\d.]+)(m?s)/i) || []);
  if (inline[1]) return Math.min(90, Math.ceil(+inline[1] * (inline[2] === 'ms' ? 0.001 : 1)));
  return 0;
}
// A daily allowance will not clear however long we sit here; a per-minute one will.
const isDailyCap = e => /\b429\b/.test(e.message) && /per ?day|PerDay|quota/i.test(e.message);

async function withFallback(call, chain, note, paced) {
  let last;
  for (let mi = 0; mi < chain.length; mi++) {
    const model = chain[mi];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await call(model);
        if (mi > 0) note(model);
        return rows;
      } catch (e) {
        last = e;
        if (!isBusy(e)) throw e;                       // a real error: surface it
        if (isDailyCap(e)) break;                      // spent for the day: next model
        // A provider metered per minute is waited out rather than abandoned — moving to
        // another model would not help, because the budget is shared across the account.
        const hinted = waitHint(e);
        if (paced || hinted) {
          const secs = hinted || 20;
          ctx.log(`rate limited — waiting ${secs}s…`);
          await new Promise(r => setTimeout(r, secs * 1000 + 500));
          continue;
        }
        if (/\b(429|503)\b/.test(e.message)) break;    // saturated alias: next model
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  throw last;
}

// Same request the direct Gemini path sends, aimed at the team Worker instead. No key
// travels with it; the Worker holds that and adds it upstream.
async function callProxy(batch, model, roster) {
  const r = await fetch(apiUrl('/' + encodeURIComponent(model)), {
    method: 'POST',
    headers: apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        ...batch.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d } })),
        { text: buildPrompt(roster, false) }] }],
      generationConfig: {
        temperature: 0, maxOutputTokens: 32768,
        // The same recording gives the same rows. Temperature 0 was never enough on its own —
        // two identical requests came back 3,666 and 3,883 characters long — because it only
        // says "take the likeliest token", and which token that is still shifts with how the
        // request happened to be batched on the server. A seed pins that down: the same pair
        // of requests came back byte for byte identical.
        //
        // Frame extraction was already deterministic — three extractions of one video produced
        // 153 byte-identical frames — so with this the whole pipeline is repeatable, and a run
        // that loses a rank loses it every time rather than one time in five. That is worth as
        // much as the fix: a fault you can reproduce is a fault you can chase.
        seed: 7,
        thinkingConfig: { thinkingLevel: 'low' },
        // Ask the API to enforce the shape rather than hoping the model returns clean JSON.
        // Everything is a string: models will happily emit "1,234" or "#4" for a number and
        // then the whole response is rejected, so take text and convert here.
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              rank:        { type: 'STRING' },
              roster_name: { type: 'STRING' },
              seen:        { type: 'STRING' },
              points:      { type: 'STRING' },
            },
            required: ['rank', 'seen', 'points'],
          },
        },
      }
    })
  });
  if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  // What it actually cost, as reported rather than guessed — the gate above is working from an
  // estimate, and an estimate that drifts low would walk the run straight back into a 429.
  if (j.usageMetadata) {
    callProxy.lastUsage = j.usageMetadata.totalTokenCount || 0;
    callProxy.spent = (callProxy.spent || 0) + callProxy.lastUsage;
    callProxy.calls = (callProxy.calls || 0) + 1;
  }
  return parseJSON(j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '');
}

// Parse row objects individually rather than requiring one well-formed array. A long
// batch can be cut off mid-object when it runs into the output limit, and demanding
// valid JSON throws away the fifty good rows that arrived before the cut. Frames overlap
// heavily, so a salvaged tail costs nothing; a hard failure costs the whole batch.
function parseJSON(text) {
  const objs = text.match(/\{[^{}]*\}/g) || [];
  const rows = [];
  for (const o of objs) {
    try {
      const r = JSON.parse(o);
      if (r.seen !== undefined || r.roster_name !== undefined) {
        // Both of these are the RAW reading. The model's roster pick stays in roster_name
        // and travels only by the verified route: it used to be copied into `plain` as well,
        // which meant a claim rejected as implausible simply came back through the other
        // argument to resolve() and matched anyway. A verification that can be walked around
        // is not a verification.
        r.name  = r.seen || r.roster_name || '';
        r.plain = r.seen || r.roster_name || '';
      }
      // the schema returns strings; "1,234" and "#4" both turn up
      const num = v => {
        if (typeof v === 'number') return v;
        const m = String(v ?? '').replace(/[,\s]/g, '').match(/-?\d+/);
        return m ? +m[0] : null;
      };
      r.points = num(r.points);
      r.rank   = num(r.rank);
      if (typeof r.points === 'number' && (r.name || r.plain)) rows.push(r);
    } catch { /* a half-written object at the cut: skip it */ }
  }
  // "I found nothing here" is a legitimate answer, not a failure: a batch can hold only
  // frames from before the Ranking panel was open, and since the model is now told to
  // ignore other screens it correctly returns nothing for those. Treat a well-formed empty
  // answer as empty, and only complain when the reply had no JSON in it at all.
  // A bare "[]" is the same legitimate answer as a list of nulls: these frames held no
  // Ranking rows. Only complain when the reply contains no JSON array at all, which is what
  // a refusal or a truncated preamble looks like.
  if (!rows.length && !objs.length && !/\[\s*\]/.test(text) && !/^\s*\[/.test(text.trim()))
    throw new Error('model returned no readable rows:\n' + text.slice(0, 200));
  return rows;
}

// Rows carried in from another screen. The opening seconds of a recording often show a
// different leaderboard whose scores are an order of magnitude larger, and raising the frame

export { callModel, callProxy, withFallback, parseJSON, TPM_TARGET, CHARS_PER_TOKEN, IMG_TOKENS };
