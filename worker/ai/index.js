/**
 * Asking a spreadsheet a question.
 *
 *   question + the rows on screen → one model call → an analysis in a fixed shape → the sidebar
 *   draws it with its own components
 *
 * Two things are deliberate. The model never writes markup: it returns an object that is checked
 * against a schema before a single component is drawn. And nothing is stored — the rows arrive
 * with the question, are answered from, and are dropped, so the answer is exactly as current as
 * the sheet and there is no second copy of anybody's data anywhere.
 */
import { HttpError, str } from '../util.js';
import { chat, describeProvider } from './providers.js';

const TABLE_ROWS = 200, CHART_ROWS = 60;

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

const SYSTEM = `You are the analyst inside Kartz, a sidebar that lives in a Google spreadsheet.

WHAT YOU ARE LOOKING AT
The rows of the tab the person has open, exactly as the sheet shows them, with the headings
they chose. Nothing else. There is no database behind this and no other table to consult: if
the answer is not in the rows you were given, say so and set confidence to "unavailable".

The columns are whatever that sheet happens to have. Do not assume a column exists because it
usually would, and do not rename one to something tidier — quote the heading as written.

Many of these sheets are about a mobile game's alliances, named 698W, 698S, 698N and 698C. A
value like z1.Transferred, z3.? or Unknown is not an alliance: it marks somebody who left or
could not be placed. Leave those out of an alliance comparison, and say in the summary that you
did.

HOW TO ANSWER
- Every figure you state must come from the rows you were given. Never estimate, never fill a
  gap from memory.
- Answer the question that was asked, at the size it was asked. A single figure is a summary
  and one metric. Do not add a chart because a chart is available.
- ranking → a table or a horizontal bar chart
- change over time → a line chart
- distribution → a bar chart, not a pie
- a single figure → a metric
- Say how many rows you read in sources, so the answer can be checked against the sheet.
`;

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

// Models do not always use the names they are asked for — a small one especially. The common other
// spellings are read as what they plainly mean, so an answer is drawn rather than dumped as JSON.
const list = v => (Array.isArray(v) ? v : []);
function readAlternates(raw) {
  const o = { ...raw };
  if (!str(o.summary)) {
    const said = o.answer ?? o.text ?? o.response ?? o.result ?? o.explanation;
    o.summary = typeof said === 'string' ? said : '';
  }
  const conf = str(o.confidence).toLowerCase();
  if (!['measured', 'inferred', 'unavailable'].includes(conf))
    o.confidence = /low|guess|estimat/.test(conf) ? 'inferred' : /none|unavail/.test(conf) ? 'unavailable' : 'measured';
  if (!Array.isArray(o.components)) {
    const out = [];
    for (const m of list(o.metrics))
      out.push({ type: 'metric', label: m && (m.label ?? m.name), value: m && m.value, unit: m && m.unit,
                 delta: m && (m.delta ?? m.change), note: m && m.note });
    for (const ch of list(o.charts)) {
      if (!ch || typeof ch !== 'object') continue;
      const data = list(ch.data ?? ch.rows ?? ch.values);
      if (/line/i.test(str(ch.type)))
        out.push({ type: 'line_chart', title: ch.title, x: ch.x, y: ch.y,
                   series: list(ch.series).length ? ch.series
                     : [{ name: ch.title || 'value', points: data.map(d => ({ x: d && (d.x ?? d.label), y: d && (d.y ?? d.value) })) }] });
      else out.push({ type: 'bar_chart', title: ch.title, x: ch.x, y: ch.y, rows: data });
    }
    for (const t of list(o.tables)) if (t && typeof t === 'object') out.push({ ...t, type: 'table' });
    o.components = out;
  }
  return o;
}

export function cleanAnalysis(raw, fallbackText) {
  const obj = readAlternates(raw && typeof raw === 'object' ? raw : {});
  // A reply that is JSON nobody could read is not an answer to show anyone.
  if (!str(obj.summary) && /^\s*[[{]/.test(str(fallbackText)))
    fallbackText = 'The answer came back in a shape this app could not read. Ask again.';
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
/**
 * A question about the tab in front of somebody.
 *
 * One call. The rows travel with the question rather than being fetched, because there is
 * nothing to fetch them from — the spreadsheet is the data now. That makes the answer exactly
 * as current as the sheet, and it means nothing is stored here: the rows are read, answered
 * from, and dropped.
 *
 * The rows are capped. A sheet with four thousand of them would cost more to ask about than
 * the answer is worth, so the newest are sent and the answer says how many were left out.
 */
const ASK_ROWS = 300;

export async function ask(env, body) {
  const question = str(body && body.question);
  if (!question) throw new HttpError(400, 'ask something.');

  const sheet = (body && body.sheet) || {};
  const headers = Array.isArray(sheet.headers) ? sheet.headers.map(str).filter(Boolean) : [];
  const all = Array.isArray(sheet.rows) ? sheet.rows : [];
  const rows = all.slice(0, ASK_ROWS);
  if (!rows.length) {
    throw new HttpError(400, 'there are no rows on that tab to answer from.');
  }

  const table = [headers.join(' | '), ...rows.map(r => (Array.isArray(r) ? r : []).map(str).join(' | '))]
    .join('\n');

  const context = [
    `Spreadsheet: ${str(sheet.spreadsheet) || 'untitled'}`,
    `Tab: ${str(sheet.sheet) || 'untitled'}`,
    `${all.length} rows on the tab${all.length > rows.length ? `, the first ${rows.length} shown below` : ''}`,
    '',
    table,
  ].join('\n');

  const out = await chat(env, {
    system: SYSTEM,
    schema: ANALYSIS_SCHEMA,
    messages: [
      { role: 'user', content: context },
      { role: 'user', content: question },
    ],
  });

  let parsed = null;
  try { parsed = JSON.parse(out.text); } catch { parsed = extractJson(out.text); }
  const analysis = cleanAnalysis(parsed, out.text);
  if (!analysis.sources || !analysis.sources.length) {
    analysis.sources = [{ dataset: str(sheet.sheet) || 'this tab', rows: rows.length }];
  }
  return {
    ...analysis,
    provider: out.provider,
    model: out.model,
    usage: out.usage || null,
    rowsRead: rows.length,
    rowsNotRead: Math.max(0, all.length - rows.length),
  };
}

export function aiStatus(env) {
  const info = describeProvider(env);
  return {
    available: info.available,
    provider: info.name || null,
    model: info.available ? info.model : null,
    gateway: info.gateway,
    reason: info.available ? null
      : 'no AI provider is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_KEY as a '
        + 'Worker secret, or add an [ai] binding. Everything else in the app works without one.',
  };
}
