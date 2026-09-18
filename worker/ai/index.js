/**
 * Asking the data a question.
 *
 *   question → the model picks tools → this Worker runs them against D1 → the model writes an
 *   analysis in a fixed shape → the browser draws it with its own components
 *
 * Three things are deliberate. The dataset is never sent to the model: it asks for a count, a
 * group, a page of rows. The model never writes SQL or markup: it fills in arguments that are
 * checked against columns that exist, and returns an object that is checked against a schema
 * before anything is drawn. And nothing here is load-bearing for the rest of the app — if no
 * provider is configured, the workspace loses a panel and keeps everything else.
 */
import { HttpError, str } from '../util.js';
import { chat, describeProvider } from './providers.js';
import { TOOLS, TOOL_BY_NAME, workspaceTool } from './tools.js';

const MAX_ROUNDS = 6;
const TABLE_ROWS = 200, CHART_ROWS = 60;
// How many rows of one lookup the model is shown. A 200-row result is ~11k tokens, re-sent on every
// round after it; fifty is plenty to answer from and keeps the worst question near 25k, not 68k.
const MODEL_ROWS = 50;

const COMPONENT_TYPES = ['text', 'metric', 'table', 'list', 'bar_chart', 'line_chart', 'comparison'];

// The shape an answer has to arrive in. It is small on purpose: every component here has a
// component in the browser that draws it, and anything else is dropped rather than rendered.
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'a few words naming the answer' },
    summary: { type: 'string', description: 'one or two sentences answering the question in plain words' },
    confidence: { type: 'string', enum: ['measured', 'inferred', 'unavailable'],
      description: 'measured when every claim came from a tool result; inferred when you reasoned beyond them; unavailable when the data needed does not exist' },
    components: {
      type: 'array',
      description: 'zero or more things to draw, in order. A simple factual question needs none.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: COMPONENT_TYPES },
          title: { type: 'string' },
          text: { type: 'string', description: 'for type text' },
          label: { type: 'string', description: 'for type metric' },
          value: { description: 'for type metric: a number or a short string' },
          unit: { type: 'string' },
          delta: { type: 'number', description: 'for type metric: change against the comparison period' },
          deltaLabel: { type: 'string' },
          note: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' }, description: 'for type table' },
          rows: { type: 'array', description: 'for table: an array per row. For bar_chart and comparison: objects.',
                  items: {} },
          items: { type: 'array', description: 'for type list',
                   items: { type: 'object', properties: {
                     label: { type: 'string' }, value: {}, note: { type: 'string' } } } },
          x: { type: 'string', description: 'what the horizontal axis is' },
          y: { type: 'string', description: 'what the vertical axis is' },
          orientation: { type: 'string', enum: ['horizontal', 'vertical'] },
          series: { type: 'array', description: 'for type line_chart',
                    items: { type: 'object', properties: {
                      name: { type: 'string' },
                      points: { type: 'array', items: { type: 'object', properties: {
                        x: { type: 'string' }, y: { type: 'number' } } } } } } },
        },
        required: ['type'],
      },
    },
    sources: {
      type: 'array',
      description: 'where the numbers came from: one entry per tool result you actually used',
      items: { type: 'object', properties: {
        label: { type: 'string', description: 'in words, e.g. “698W on 2026-09-01, 153 rows”' },
        dataset: { type: 'string', description: 'the dataset argument you passed' },
        rows: { type: 'integer' },
        filters: { type: 'array', items: {} },
      } },
    },
  },
  required: ['title', 'summary'],
};

const SYSTEM = `You are the analyst inside Kartz, a tool for tracking a mobile game's monthly
scoring boards. You answer questions about the user's own data by querying it.

THE DATA
A *board* is one alliance's ranking list on one day, filmed as a screen recording and read into
rows. A row has: place (the rank the game showed), search (the player's roster name — their
identity, null for someone not on the roster), ingame (the name the video drew, which changes),
alliance (the player's own alliance, which is not always the board's), points (their score),
and possibly extra columns the user added, named "x:Whatever".
A month usually holds three boards per alliance: Day 1, Day 4 and Final. "Snapshot", "day" and
"board" all mean a board. The *roster* is the list of players.
Datasets you can name: "roster", "scores" (every board at once), "month:YYYY-MM", and
"board:<id>" (ids come from list_datasets).

HOW TO WORK
- Use the tools. Every number you state must have come out of one. Never estimate, never fill a
  gap from memory, never carry a figure over from an earlier question.
- Aggregate in the database with aggregate_records rather than fetching rows and adding up.
- Keep query_records limits small — you are looking at rows, not reading the dataset.
- Call get_workspace_context whenever the question says "these", "this board", "selected" or
  "currently". "These players" means the rows the user's filters leave, so apply the same
  filters in your own query.
- If the data needed does not exist, say so plainly and set confidence to "unavailable". "There
  is no board for August, so I cannot compare with it" is a good answer. An invented number is
  not an answer at all.
- If a tool refuses an argument, read what it says and try the argument it suggests. Do not
  invent column or dataset names.

HOW TO ANSWER
Answer the question that was asked, at the size it was asked. "What is the average power?" is a
summary and one metric. Do not add a chart because a chart is available.
- ranking → a table or a horizontal bar chart
- change over time → a line chart
- distribution → a bar chart, not a pie
- comparing categories → a bar chart or a table
- a single figure → a metric, and a comparison only if it is genuinely informative
Name the dataset and the row count in sources so the answer can be checked against the rows.`;

function toolList(context) {
  return [workspaceTool(context), ...TOOLS];
}

const toolSpec = t => ({ name: t.name, description: t.description, schema: t.schema });

// ---------------------------------------------------------------------------------------
// Validation. Model output is untrusted: it decides what to say, never what may be drawn.
// ---------------------------------------------------------------------------------------
const num = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return null;                       // Number('') is 0, which is a figure, not a gap
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const cell = v => (v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v).slice(0, 300));

function cleanComponent(c) {
  if (!c || typeof c !== 'object') return null;
  const type = str(c.type);
  if (!COMPONENT_TYPES.includes(type)) return null;
  const base = { type, title: c.title ? str(c.title).slice(0, 120) : undefined,
                 note: c.note ? str(c.note).slice(0, 300) : undefined };
  if (type === 'text') {
    const text = str(c.text);
    return text ? { ...base, text: text.slice(0, 4000) } : null;
  }
  if (type === 'metric') {
    if (c.value === null || c.value === undefined) return null;
    return { ...base, label: str(c.label).slice(0, 80) || 'Value',
             value: typeof c.value === 'number' ? c.value : str(c.value).slice(0, 60),
             unit: c.unit ? str(c.unit).slice(0, 16) : undefined,
             delta: num(c.delta), deltaLabel: c.deltaLabel ? str(c.deltaLabel).slice(0, 60) : undefined };
  }
  if (type === 'table') {
    const columns = (Array.isArray(c.columns) ? c.columns : []).slice(0, 12).map(h => str(h).slice(0, 60));
    const rows = (Array.isArray(c.rows) ? c.rows : []).slice(0, TABLE_ROWS).map(r =>
      Array.isArray(r) ? r.slice(0, columns.length || 12).map(cell)
        : columns.map(h => cell(r && typeof r === 'object' ? r[h] : '')));
    if (!columns.length || !rows.length) return null;
    return { ...base, columns, rows };
  }
  if (type === 'list') {
    const items = (Array.isArray(c.items) ? c.items : []).slice(0, TABLE_ROWS)
      .map(i => ({ label: str(i && i.label).slice(0, 120),
                   value: i && i.value !== undefined ? cell(i.value) : '',
                   note: i && i.note ? str(i.note).slice(0, 80) : undefined }))
      .filter(i => i.label);
    return items.length ? { ...base, items } : null;
  }
  if (type === 'bar_chart') {
    const rows = (Array.isArray(c.rows) ? c.rows : []).slice(0, CHART_ROWS).map(r => {
      if (!r || typeof r !== 'object') return null;
      const label = str(r.label ?? r.name ?? r.group ?? r.x ?? r[c.x]);
      const value = num(r.value ?? r.y ?? r[c.y]);
      return label && value !== null ? { label: label.slice(0, 60), value } : null;
    }).filter(Boolean);
    return rows.length ? { ...base, rows, x: str(c.x) || undefined, y: str(c.y) || undefined,
                           orientation: c.orientation === 'vertical' ? 'vertical' : 'horizontal' } : null;
  }
  if (type === 'line_chart') {
    const series = (Array.isArray(c.series) ? c.series : []).slice(0, 6).map(s => ({
      name: str(s && s.name).slice(0, 60) || 'series',
      points: (Array.isArray(s && s.points) ? s.points : []).slice(0, 400)
        .map(p => ({ x: str(p && p.x).slice(0, 40), y: num(p && p.y) }))
        .filter(p => p.x && p.y !== null),
    })).filter(s => s.points.length > 1);
    return series.length ? { ...base, series, x: str(c.x) || undefined, y: str(c.y) || undefined } : null;
  }
  if (type === 'comparison') {
    const rows = (Array.isArray(c.rows) ? c.rows : []).slice(0, TABLE_ROWS).map(r => {
      if (!r || typeof r !== 'object') return null;
      const label = str(r.label ?? r.player ?? r.name);
      const before = num(r.before), after = num(r.after);
      if (!label || before === null || after === null) return null;
      return { label: label.slice(0, 80), before, after,
               change: num(r.change) ?? after - before,
               note: r.note ? str(r.note).slice(0, 60) : undefined };
    }).filter(Boolean);
    return rows.length ? { ...base, rows } : null;
  }
  return null;
}

export function cleanAnalysis(raw, fallbackText) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const components = (Array.isArray(obj.components) ? obj.components : [])
    .slice(0, 12).map(cleanComponent).filter(Boolean);
  const summary = str(obj.summary).slice(0, 2000)
    || str(fallbackText).slice(0, 2000)
    || 'No answer came back.';
  const confidence = ['measured', 'inferred', 'unavailable'].includes(str(obj.confidence))
    ? str(obj.confidence) : 'measured';
  const sources = (Array.isArray(obj.sources) ? obj.sources : []).slice(0, 8).map(s => ({
    label: str(s && s.label).slice(0, 160),
    dataset: str(s && s.dataset).slice(0, 160) || undefined,
    rows: Number.isFinite(Number(s && s.rows)) ? Number(s.rows) : undefined,
    filters: Array.isArray(s && s.filters) ? s.filters.slice(0, 8) : undefined,
  })).filter(s => s.label || s.dataset);
  return {
    type: 'analysis',
    title: str(obj.title).slice(0, 120) || 'Answer',
    summary, confidence, components, sources,
  };
}

function extractJson(text) {
  const t = str(text);
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* it may be fenced or have prose around it */ }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* keep looking */ } }
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(t.slice(first, last + 1)); } catch { /* give up */ } }
  return null;
}

// ---------------------------------------------------------------------------------------
// The ask
// ---------------------------------------------------------------------------------------
export async function ask(env, body) {
  const question = str(body && body.question);
  if (!question) throw new HttpError(400, 'ask a question.');
  if (question.length > 2000) throw new HttpError(400, 'that question is too long.');
  const context = body && typeof body.context === 'object' ? body.context : null;
  const history = (Array.isArray(body && body.history) ? body.history : []).slice(-6)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && str(m.content))
    .map(m => ({ role: m.role, content: str(m.content).slice(0, 4000) }));

  const tools = toolList(context);
  const specs = tools.map(toolSpec);
  const messages = [...history, { role: 'user', content: question }];
  const trace = [];

  let rounds = 0;
  let answerText = '';
  let model = null, provider = null;
  // What the answer cost, as the provider counted it, for the meter under it.
  const usage = { input: 0, output: 0, calls: 0 };
  const tally = o => {
    usage.calls++;
    if (o && o.usage) { usage.input += o.usage.input || 0; usage.output += o.usage.output || 0; }
  };

  while (rounds < MAX_ROUNDS) {
    rounds++;
    const out = await chat(env, { system: SYSTEM, messages, tools: specs, maxTokens: 6000 });
    tally(out);
    model = out.model; provider = out.provider;
    if (out.stop === 'refusal')
      return { analysis: cleanAnalysis({ title: 'Not answered', summary: out.refusal,
                                         confidence: 'unavailable' }), trace, model, provider };
    if (!out.toolCalls.length) { answerText = out.text; break; }

    messages.push({ role: 'assistant', content: out.text || '', toolCalls: out.toolCalls });
    for (const call of out.toolCalls.slice(0, 5)) {
      const tool = tools.find(t => t.name === call.name);
      let result;
      if (!tool) {
        result = { error: `there is no tool called “${call.name}”. Available: ${tools.map(t => t.name).join(', ')}.` };
      } else {
        try { result = await tool.run(env, call.args || {}); }
        catch (e) { result = { error: String((e && e.message) || e) }; }
      }
      trace.push({ tool: call.name, args: call.args || {},
                   ok: !result.error, error: result.error || null,
                   rows: Array.isArray(result.rows) ? result.rows.length
                       : Array.isArray(result.groups) ? result.groups.length : undefined });
      const shown = Array.isArray(result.rows) && result.rows.length > MODEL_ROWS
        ? { ...result, rows: result.rows.slice(0, MODEL_ROWS), rowsNotShown: result.rows.length - MODEL_ROWS }
        : result;
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name,
                      content: JSON.stringify(shown).slice(0, 60000) });
    }
  }

  // The render pass. Tools are dropped here so the schema can be attached: some providers will
  // not constrain the output format and offer functions in the same request.
  const render = await chat(env, {
    system: SYSTEM,
    messages: [...messages, { role: 'user', content:
      'Now write the analysis as JSON in the required shape. Use only figures that came back '
      + 'from the tools above. Include a sources entry for each result you used. Add a chart '
      + 'only where it makes the answer easier to read.' }],
    schema: ANALYSIS_SCHEMA,
    maxTokens: 8000,
  }).catch(e => ({ text: '', error: e }));
  tally(render);

  const parsed = extractJson(render && render.text) || extractJson(answerText);
  const analysis = cleanAnalysis(parsed, (render && render.text) || answerText);
  if (!parsed && !answerText && render && render.error) throw render.error;
  return { analysis, trace, model: (render && render.model) || model,
           provider: (render && render.provider) || provider, rounds, usage };
}

export function aiStatus(env) {
  const info = describeProvider(env);
  return {
    available: info.available,
    provider: info.name || null,
    model: info.available ? info.model : null,
    gateway: info.gateway,
    tools: TOOLS.map(t => t.name),
    reason: info.available ? null
      : 'no AI provider is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_KEY as a '
        + 'Worker secret, or add an [ai] binding. Everything else in the app works without one.',
  };
}
