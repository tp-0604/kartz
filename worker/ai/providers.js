/**
 * One shape of conversation, four places to send it.
 *
 * The analytics layer must not be a rewrite away from a different model. So everything above
 * this file speaks one dialect — a system prompt, a list of messages, a list of tools, and
 * optionally a JSON schema the final answer must fit — and each adapter below translates it
 * into whatever its provider wants and translates the answer back.
 *
 * Which provider is used is a property of the deployment, not of the code: whichever secret is
 * set. This Worker already holds GEMINI_KEY for the extractor, so an installation that adds
 * nothing at all still gets analytics.
 *
 *   AI_PROVIDER   anthropic | openai | google | workers-ai   (optional; otherwise inferred)
 *   AI_MODEL      overrides the provider's default model
 *   AI_GATEWAY    a Cloudflare AI Gateway base URL, if you want routing and observability
 *
 * The normalised message shape:
 *   { role: 'user' | 'assistant' | 'tool', content: string,
 *     toolCalls: [{ id, name, args }],           // assistant turns that called tools
 *     toolCallId: string }                       // tool turns answering one
 *
 * And the normalised answer: { text, toolCalls, stop }.
 */

const DEFAULTS = {
  anthropic: 'claude-opus-5',
  openai: 'gpt-4.1-mini',
  google: 'gemini-3.5-flash',
  'workers-ai': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
};

// A model that has gone away should not take the feature with it.
const FALLBACKS = {
  google: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'],
  anthropic: ['claude-opus-5', 'claude-sonnet-5'],
  openai: ['gpt-4.1-mini'],
  'workers-ai': ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
};

export function describeProvider(env) {
  const explicit = (env.AI_PROVIDER || '').trim();
  const name = explicit
    || (env.ANTHROPIC_API_KEY && 'anthropic')
    || (env.OPENAI_API_KEY && 'openai')
    || (env.GEMINI_KEY && 'google')
    || (env.AI && 'workers-ai')
    || '';
  return {
    name,
    model: (env.AI_MODEL || '').trim() || DEFAULTS[name] || '',
    gateway: !!(env.AI_GATEWAY || '').trim(),
    available: !!name && !!(
      name === 'anthropic' ? env.ANTHROPIC_API_KEY
      : name === 'openai' ? env.OPENAI_API_KEY
      : name === 'google' ? env.GEMINI_KEY
      : name === 'workers-ai' ? env.AI : null),
  };
}

const gatewayBase = env => (env.AI_GATEWAY || '').trim().replace(/\/+$/, '');

const endpoint = (env, provider, path) => {
  const gw = gatewayBase(env);
  if (gw) {
    const slug = { anthropic: 'anthropic', openai: 'openai', google: 'google-ai-studio' }[provider];
    if (slug) return `${gw}/${slug}${path}`;
  }
  return ({
    anthropic: 'https://api.anthropic.com' + path,
    openai: 'https://api.openai.com' + path,
    google: 'https://generativelanguage.googleapis.com' + path,
  })[provider];
};

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* an error page, not JSON */ }
  if (!res.ok) {
    const message = (json && json.error && (json.error.message || json.error))
      || text.slice(0, 300) || `the model provider answered ${res.status}`;
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---- Anthropic -------------------------------------------------------------------------
// Tool calls arrive as tool_use content blocks and are answered with tool_result blocks in the
// next user turn. stop_reason is checked before the content is read: a refusal is a 200.
async function anthropicChat(env, { model, system, messages, tools, schema, maxTokens }) {
  const body = {
    model, max_tokens: maxTokens || 8000,
    system,
    messages: messages.map(m => {
      if (m.role === 'tool')
        return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] };
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length)
        return { role: 'assistant', content: [
          ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ...m.toolCalls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
        ] };
      return { role: m.role, content: m.content };
    }),
  };
  if (tools && tools.length)
    body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema }));
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };

  const out = await postJson(endpoint(env, 'anthropic', '/v1/messages'),
    { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body);

  if (out.stop_reason === 'refusal')
    return { text: '', toolCalls: [], stop: 'refusal',
             refusal: (out.stop_details && out.stop_details.explanation) || 'the model declined this request.' };
  const blocks = out.content || [];
  return {
    text: blocks.filter(b => b.type === 'text').map(b => b.text).join(''),
    toolCalls: blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} })),
    stop: out.stop_reason,
    usage: out.usage ? { input: out.usage.input_tokens || 0, output: out.usage.output_tokens || 0 } : null,
  };
}

// ---- OpenAI-compatible -------------------------------------------------------------------
async function openaiChat(env, { model, system, messages, tools, schema, maxTokens }) {
  const body = {
    model, max_completion_tokens: maxTokens || 8000,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map(m => {
        if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length)
          return { role: 'assistant', content: m.content || null,
                   tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function',
                     function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
        return { role: m.role, content: m.content };
      }),
    ],
  };
  if (tools && tools.length)
    body.tools = tools.map(t => ({ type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema } }));
  if (schema)
    body.response_format = { type: 'json_schema', json_schema: { name: 'analysis', schema, strict: false } };

  const out = await postJson(endpoint(env, 'openai', '/v1/chat/completions'),
    { authorization: 'Bearer ' + env.OPENAI_API_KEY }, body);
  const msg = (out.choices && out.choices[0] && out.choices[0].message) || {};
  return {
    text: msg.content || '',
    toolCalls: (msg.tool_calls || []).map(c => ({
      id: c.id, name: c.function.name,
      args: (() => { try { return JSON.parse(c.function.arguments || '{}'); } catch { return {}; } })(),
    })),
    stop: out.choices && out.choices[0] && out.choices[0].finish_reason,
    usage: out.usage ? { input: out.usage.prompt_tokens || 0, output: out.usage.completion_tokens || 0 } : null,
  };
}

// ---- Google ------------------------------------------------------------------------------
async function googleChat(env, { model, system, messages, tools, schema, maxTokens }) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      contents.push({ role: 'user', parts: [{ functionResponse: {
        name: m.name || 'tool',
        response: (() => { try { return JSON.parse(m.content); } catch { return { result: m.content }; } })(),
      } }] });
      continue;
    }
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    // Gemini 3 signs its tool calls and refuses the next turn unless each signature comes back
    // on the part it arrived on.
    for (const c of m.toolCalls || [])
      parts.push({ functionCall: { name: c.name, args: c.args },
                   ...(c.signature ? { thoughtSignature: c.signature } : {}) });
    if (!parts.length) continue;
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  const body = {
    contents,
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens || 8000,
                        ...(schema ? { responseMimeType: 'application/json' } : {}) },
    // A JSON mime type alone lets the model choose its own shape, and a small model will. The
    // shape is spelled out in the instructions too, so the answer arrives as the app reads it.
    ...(system || schema ? { systemInstruction: { parts: [{ text: [system, schema
      ? 'Reply with one JSON object and nothing else. It must match this JSON Schema — these '
        + 'property names and these types, and no others:\n' + JSON.stringify(stripSchema(schema))
      : ''].filter(Boolean).join('\n\n') }] } } : {}),
  };
  if (tools && tools.length)
    body.tools = [{ functionDeclarations: tools.map(t => ({
      name: t.name, description: t.description, parameters: stripSchema(t.schema) })) }];

  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const url = endpoint(env, 'google', path);
  const headers = gatewayBase(env)
    ? { 'x-goog-api-key': env.GEMINI_KEY }
    : {};
  const out = await postJson(url + (gatewayBase(env) ? '' : '?key=' + encodeURIComponent(env.GEMINI_KEY)),
                             headers, body);
  const parts = (out.candidates && out.candidates[0] && out.candidates[0].content
                 && out.candidates[0].content.parts) || [];
  return {
    text: parts.filter(p => p.text).map(p => p.text).join(''),
    toolCalls: parts.filter(p => p.functionCall).map((p, i) => ({
      id: 'call_' + i, name: p.functionCall.name, args: p.functionCall.args || {},
      ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}) })),
    stop: out.candidates && out.candidates[0] && out.candidates[0].finishReason,
    usage: out.usageMetadata ? { input: out.usageMetadata.promptTokenCount || 0,
                                 output: out.usageMetadata.candidatesTokenCount || 0 } : null,
  };
}

// Gemini's schema dialect is a subset: it rejects the JSON Schema keywords the others accept.
function stripSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(stripSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue;
    out[k] = typeof v === 'object' && v !== null ? stripSchema(v) : v;
  }
  return out;
}

// ---- Cloudflare Workers AI -----------------------------------------------------------------
// Reached through the binding, so no token is needed and nothing leaves the account. Tool
// support varies by model; where a model has none, the loop simply gets one answer.
async function workersAiChat(env, { model, system, messages, tools, maxTokens }) {
  if (!env.AI) throw new Error('this Worker has no AI binding.');
  const body = {
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.map(m => m.role === 'tool'
        ? { role: 'tool', content: m.content, tool_call_id: m.toolCallId }
        : { role: m.role, content: m.content || '' }),
    ],
    max_tokens: maxTokens || 4096,
    temperature: 0,
  };
  if (tools && tools.length)
    body.tools = tools.map(t => ({ type: 'function',
      function: { name: t.name, description: t.description, parameters: t.schema } }));
  const out = await env.AI.run(model, body);
  const reply = out?.response ?? out?.result?.response ?? '';
  const calls = out?.tool_calls || out?.result?.tool_calls || [];
  return {
    text: typeof reply === 'string' ? reply : JSON.stringify(reply),
    toolCalls: calls.map((c, i) => ({
      id: c.id || 'call_' + i,
      name: c.name || (c.function && c.function.name),
      args: typeof c.arguments === 'string'
        ? (() => { try { return JSON.parse(c.arguments); } catch { return {}; } })()
        : (c.arguments || (c.function && c.function.arguments) || {}),
    })),
    stop: 'stop',
  };
}

const ADAPTERS = { anthropic: anthropicChat, openai: openaiChat, google: googleChat, 'workers-ai': workersAiChat };

/**
 * One turn of conversation with whichever provider this deployment has.
 * @returns {{ text, toolCalls, stop, model, provider }}
 */
export async function chat(env, request) {
  const info = describeProvider(env);
  if (!info.available)
    throw Object.assign(new Error(
      'no AI provider is configured on this Worker. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY '
      + 'or GEMINI_KEY as a secret, or add an [ai] binding.'), { status: 503 });
  const adapter = ADAPTERS[info.name];
  if (!adapter) throw new Error(`unknown AI provider “${info.name}”.`);

  const tried = [];
  // `cheap` asks for the smallest model the provider has first — for chores like a log entry.
  const cheapest = request.cheap ? (FALLBACKS[info.name] || []).slice(-1) : [];
  const models = [...cheapest, info.model, ...(FALLBACKS[info.name] || [])].filter((m, i, a) => m && a.indexOf(m) === i);
  const retryMs = Number(env.AI_RETRY_MS ?? 1200);
  let last = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await adapter(env, { ...request, model });
        return { ...out, model, provider: info.name };
      } catch (e) {
        last = e;
        // A busy model usually answers a moment later, so it gets one more try before moving on.
        if (busy(e) && attempt === 0) { await pause(retryMs); continue; }
        break;
      }
    }
    tried.push(model);
    // Worth the next model along: one that is missing or refused this request (404, 400), one that
    // is overloaded, or one whose quota is spent (429) — Gemini counts quota per model, and the
    // smaller one is often free when the larger is not. A bad key fails the same way everywhere.
    if (!(last.status === 404 || last.status === 400 || last.status === 429 || busy(last))) break;
  }
  if (busy(last))
    last = Object.assign(new Error('The AI is busy right now — the provider is overloaded, on its '
      + 'smaller model too. It usually passes within a minute; try again shortly.'), { status: 503 });
  throw Object.assign(last || new Error('the model provider could not be reached.'),
                      { tried, provider: info.name });
}

// Busy is not broken: an overloaded provider answers 503 (Google says "high demand" or
// UNAVAILABLE; Anthropic uses 529). That is worth a retry and a smaller model; nothing else is.
function busy(e) {
  if (!e) return false;
  return e.status === 503 || e.status === 529
    || /high demand|overloaded|\bUNAVAILABLE\b/i.test(String(e.message || ''));
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
