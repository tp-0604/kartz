/**
 * The log, in words.
 *
 * Every save writes a plain line at once — "3 rows changed" — so the log never waits on a model.
 * Every five minutes this reads the saves that have gone quiet: one person, one dataset, nothing
 * more from them there for three minutes. That is an editing session, and it becomes one entry,
 * written by the cheapest model from the actual before-and-after values the saves recorded. With
 * no model configured, or a model that fails, the entry is a plain sentence instead; either way the
 * saves are marked, so a session is described once.
 */
import { chat, describeProvider } from './ai/providers.js';
import { chunk, now, parseJson } from './util.js';

const QUIET_MS = 3 * 60 * 1000;

const SYSTEM = `You write one entry for the activity log of Kartz, an app that tracks a mobile
game's score boards. You are given one person's editing session on one board or on the roster:
the counts, and the changes as {row, fields: {field: [before, after]}}, {row, added} or
{row, deleted}. Fields: place is the rank, points the score, search the roster name, ingame the
name the video showed, alliance the player's alliance; anything else is a column the users added.

Write one or two plain sentences, past tense, starting with the person's name. Say where, and say
what actually changed — with the players and the numbers (before → after) when there are a few,
as a summary when there are many. No preamble, no markdown, no quotes, no guessing why.`;

async function placeName(env, dataset) {
  if (!dataset || dataset === 'roster') return 'the roster';
  const id = dataset.replace(/^board:/, '');
  const b = await env.DB.prepare('SELECT alliance, date, label FROM boards WHERE id = ?').bind(id).first();
  if (!b) return 'a board since deleted';
  return `${b.alliance} ${b.label ? b.label + ' ' : ''}(${b.date})`;
}

async function describe(env, rows) {
  const who = rows[0].actor_name || 'Someone';
  const where = await placeName(env, rows[0].dataset);
  const counts = { changed: 0, added: 0, deleted: 0, columnsChanged: false };
  const changes = [];
  for (const r of rows) {
    const d = parseJson(r.detail, {}) || {};
    const c = d.counts || {};
    counts.changed += c.changed || 0;
    counts.added += c.added || 0;
    counts.deleted += c.deleted || 0;
    counts.columnsChanged = counts.columnsChanged || !!c.columns;
    for (const x of d.changes || []) changes.push(x);
  }
  const parts = [counts.changed && `${counts.changed} changed`, counts.added && `${counts.added} added`,
                 counts.deleted && `${counts.deleted} deleted`, counts.columnsChanged && 'columns changed']
    .filter(Boolean);
  const plain = `${who} edited ${where}${parts.length ? ': ' + parts.join(', ') : ''}.`;

  let ai = null;
  if (describeProvider(env).available) {
    try {
      const out = await chat(env, {
        cheap: true, system: SYSTEM, maxTokens: 220,
        messages: [{ role: 'user', content: JSON.stringify({
          person: who, where, saves: rows.length, from: rows[0].at, to: rows[rows.length - 1].at,
          counts, changes: changes.slice(0, 40), moreChanges: Math.max(0, changes.length - 40),
        }) }],
      });
      ai = String(out.text || '').replace(/\s+/g, ' ').trim().slice(0, 600) || null;
    } catch { ai = null; }
  }
  return { plain, ai };
}

/** Describe every editing session that has gone quiet. `force` describes the ones still going. */
export async function summarizeSessions(env, { force = false } = {}) {
  const { results } = await env.DB.prepare(
    `SELECT id, at, dataset, detail, actor_id, actor_name FROM activity
      WHERE kind = 'edit' AND summarized = 0 AND actor_id IS NOT NULL ORDER BY at, id`).all();
  const groups = new Map();
  for (const r of results || []) {
    const k = r.actor_id + '|' + (r.dataset || '');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const cutoff = new Date(Date.now() - QUIET_MS).toISOString();
  let summarized = 0;
  for (const rows of groups.values()) {
    const last = rows[rows.length - 1];
    if (!force && last.at > cutoff) continue;                 // still editing
    const { plain, ai } = await describe(env, rows);
    const ids = rows.map(r => r.id);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO activity (at, kind, dataset, summary, detail, actor_id, actor_name, ai_summary, summarized)
         VALUES (?,?,?,?,?,?,?,?,1)`)
        .bind(now(), 'summary', last.dataset, plain,
              JSON.stringify({ edits: ids.length, from: rows[0].at, to: last.at }),
              last.actor_id, last.actor_name, ai),
      ...chunk(ids, 90).map(part => env.DB.prepare(
        `UPDATE activity SET summarized = 1 WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part)),
    ]);
    summarized++;
  }
  return { summarized };
}
