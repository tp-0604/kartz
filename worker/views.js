/**
 * The questions that cross boards: one month, one player, everything. These are reads, and the
 * workspace shows them as datasets it cannot edit — a board is where a score is corrected.
 */
import { bad, newId, now, str } from './util.js';

export async function monthView(env, { month, alliance, event = 'kartz' }) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM.');
  const where = ['b.event = ?', 'b.date LIKE ?'], bind = [event, month + '%'];
  if (alliance) { where.push('b.alliance = ?'); bind.push(alliance); }
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.date, b.label, b.alliance AS board_alliance,
            s.place, s.search, s.ingame, s.alliance, s.points
       FROM boards b JOIN scores s ON s.board_id = b.id
      WHERE ${where.join(' AND ')}
      ORDER BY b.date ASC, s.place ASC`).bind(...bind).all();
  return { month, alliance, rows: results || [] };
}

export async function playerView(env, search) {
  if (!search) throw bad('search is required.');
  const { results } = await env.DB.prepare(
    `SELECT b.date, b.alliance AS board, b.label, s.place, s.ingame, s.alliance, s.points
       FROM scores s JOIN boards b ON b.id = s.board_id
      WHERE s.search = ? ORDER BY b.date ASC`).bind(search).all();
  return { history: results || [] };
}

export async function allRows(env, limit = 20000) {
  const { results } = await env.DB.prepare(
    `SELECT b.date, b.event, b.alliance AS board, b.label, s.place, s.search, s.ingame,
            s.alliance, s.points, s.edited
       FROM scores s JOIN boards b ON b.id = s.board_id
      ORDER BY b.date DESC, b.alliance ASC, s.place ASC LIMIT ?`)
    .bind(Math.min(50000, limit)).all();
  return { rows: results || [] };
}

export async function activity(env, limit = 80) {
  const { results } = await env.DB.prepare(
    `SELECT id, at, kind, dataset, summary, detail, actor_name, ai_summary FROM activity
      ORDER BY at DESC, id DESC LIMIT ?`)
    .bind(Math.min(400, limit)).all();
  return { activity: (results || []).map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) };
}

// ---- saved views: a filter, a sort and a set of columns, under a name ---------------------
export async function listViews(env, dataset) {
  const { results } = dataset
    ? await env.DB.prepare('SELECT * FROM saved_views WHERE dataset = ? ORDER BY created_at DESC')
        .bind(dataset).all()
    : await env.DB.prepare('SELECT * FROM saved_views ORDER BY created_at DESC LIMIT 200').all();
  return { views: (results || []).map(v => ({ ...v, spec: JSON.parse(v.spec) })) };
}

export async function saveView(env, body) {
  const name = str(body && body.name);
  const dataset = str(body && body.dataset);
  if (!name) throw bad('a view needs a name.');
  if (!dataset) throw bad('a view belongs to a dataset.');
  const spec = body.spec && typeof body.spec === 'object' ? body.spec : {};
  const id = str(body.id) || newId('v');
  await env.DB.prepare(
    `INSERT INTO saved_views (id, name, dataset, spec, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, spec = excluded.spec`)
    .bind(id, name, dataset, JSON.stringify(spec), now()).run();
  return { id, name, dataset, spec };
}

export async function deleteView(env, id) {
  await env.DB.prepare('DELETE FROM saved_views WHERE id = ?').bind(id).run();
  return { deleted: id };
}
