/**
 * A board's life: created by an extraction or an import, corrected in the workspace, relabelled,
 * deleted.
 *
 * The rows are the record. Where the workspace edits them one operation at a time (datasets.js),
 * these routes write a whole board at once, because that is what producing one actually is: a
 * recording becomes a hundred and fifty rows or it does not become anything.
 */
import { forbidden, isAdmin, mayManage, nameKey, requireManage } from './auth.js';
import { bad, chunk, conflict, identity, logActivity, newId, notFound, now,
         nullable, str, toInt } from './util.js';

const MAX_ROWS = 500;                      // a Kartz board is ~150; this is a sanity bound
export const boardId = (event, date, alliance) => `${event}|${date}|${alliance}`;

const rowExtra = r => {
  if (!r.extra || typeof r.extra !== 'object') return null;
  const out = Object.fromEntries(Object.entries(r.extra).filter(([, v]) => str(v)));
  return Object.keys(out).length ? JSON.stringify(out) : null;
};

/** A row as it arrives from an extraction, an import or a paste. Null where it is unusable. */
function normalise(r, i) {
  const place = toInt(r.place ?? r.rank, null);
  const ingame = str(r.ingame ?? r.name);
  if (place === null || place <= 0 || !ingame) return null;
  return {
    place, ingame,
    search: nullable(r.search),
    alliance: nullable(r.alliance),
    points: toInt(r.points, 0) ?? 0,
    edited: r.edited ? 1 : 0,
    extra: rowExtra(r),
    sort: Number.isFinite(Number(r.sort)) ? Number(r.sort) : place,
    order: i,
  };
}

/**
 * A board's rows, written in one batch. Every way a whole board gets saved comes through here.
 *
 * mode 'merge' is the extractor's: a re-extraction of the same recording must not undo the row
 * somebody fixed by typing it, so rows already marked edited are kept over the new ones.
 * mode 'replace' is an import's and the workspace's: the rows arrive exactly as reviewed.
 *
 * expectVersion refuses a save from a copy that is behind another officer's.
 */
export async function saveBoard(env, { event, date, alliance, label, rows, columns, mode,
                                     expectVersion, allowEmpty }) {
  event = str(event) || 'kartz';
  date = str(date);
  alliance = str(alliance);
  label = nullable(label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date must be YYYY-MM-DD.');
  if (!alliance) throw bad('alliance is required.');
  if (!Array.isArray(rows)) throw bad('rows is required.');
  // An empty board is a legitimate thing to make: the workspace creates one and types into it.
  // It still has to be asked for, so a save that lost its rows on the way cannot empty a board.
  if (!rows.length && !allowEmpty) throw bad('rows is required.');
  if (rows.length > MAX_ROWS) throw bad(`too many rows (${rows.length}).`);

  const id = boardId(event, date, alliance);
  const existing = await env.DB.prepare('SELECT version, created_by FROM boards WHERE id = ?').bind(id).first();
  // Writing a whole board over one that exists replaces it: its sender's call, or an admin's.
  if (existing) requireManage(env.user, existing, 'replace the rows of');
  if (expectVersion !== undefined && expectVersion !== null && existing
      && Number(expectVersion) !== existing.version)
    throw conflict('this board was saved by someone else since you opened it — reload it and re-apply your edits.',
                   { version: existing.version });

  // Corrections made by hand survive a re-save from the extractor.
  const keep = new Map();
  if (mode === 'merge' && existing) {
    const { results } = await env.DB.prepare(
      'SELECT id, place, search, ingame, alliance, points, extra FROM scores WHERE board_id = ? AND edited = 1')
      .bind(id).all();
    for (const r of results || []) keep.set(r.place, r);
  }

  const stamp = now();
  const ins = env.DB.prepare(
    `INSERT INTO scores (id, board_id, place, search, ingame, alliance, points, edited, extra, sort)
     VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const stmts = [
    env.DB.prepare('DELETE FROM scores WHERE board_id = ?').bind(id),
    env.DB.prepare(
      `INSERT INTO boards (id, event, date, alliance, label, saved_at, version, created_by) VALUES (?,?,?,?,?,?,1,?)
       ON CONFLICT(id) DO UPDATE SET label = COALESCE(excluded.label, boards.label),
                                     saved_at = excluded.saved_at,
                                     version = boards.version + 1`)
      .bind(id, event, date, alliance, label, stamp, env.user ? env.user.id : null),
  ];

  const seen = new Set();
  let n = 0;
  for (const [i, raw] of rows.entries()) {
    const r = normalise(raw, i);
    if (!r) continue;
    if (seen.has(r.place)) continue;         // one rank, one row: a repeat is the sheet's mistake
    seen.add(r.place);
    const fixed = keep.get(r.place);
    stmts.push(fixed
      ? ins.bind(fixed.id, id, r.place, fixed.search, fixed.ingame, fixed.alliance, fixed.points,
                 1, fixed.extra, r.sort)
      : ins.bind(newId('s'), id, r.place, r.search, r.ingame, r.alliance, r.points,
                 mode === 'replace' && r.edited ? 1 : 0, r.extra, r.sort));
    n++;
  }
  if (!n && !allowEmpty) throw bad('no row had both a rank and a name.');

  if (Array.isArray(columns)) {
    const heads = [...new Set(columns.map(str).filter(Boolean))];
    stmts.push(env.DB.prepare(
      `INSERT INTO board_meta (board_id, columns, layout, imported, updated_at) VALUES (?,?,'{}',1,?)
         ON CONFLICT(board_id) DO UPDATE SET columns = excluded.columns, imported = 1,
                                             updated_at = excluded.updated_at`)
      .bind(id, JSON.stringify(heads), stamp));
  }

  for (const part of chunk(stmts, 40)) await env.DB.batch(part);
  const after = await env.DB.prepare('SELECT version FROM boards WHERE id = ?').bind(id).first();
  return { saved: n, board: id, kept: keep.size, version: after ? after.version : 1, savedAt: stamp };
}

// ---------------------------------------------------------------------------------------
// Extraction → data.
//
// The rows a run produced, going straight into the database. What used to be a clipboard and a
// spreadsheet tab is this: say what would happen, then do it.
// ---------------------------------------------------------------------------------------
const MODES = new Set(['preview', 'new', 'all', 'replace']);

export async function commitExtraction(env, body) {
  const mode = str(body.mode) || 'preview';
  if (!MODES.has(mode)) throw bad(`unknown commit mode “${mode}”.`);
  const event = str(body.event) || 'kartz';
  const date = str(body.date);
  const alliance = str(body.alliance);
  const label = nullable(body.label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date must be YYYY-MM-DD.');
  if (!alliance) throw bad('choose the alliance this board belongs to.');
  const incoming = (Array.isArray(body.rows) ? body.rows : []).map(normalise).filter(Boolean);
  if (!incoming.length) throw bad('there are no rows with both a rank and a name.');
  if (incoming.length > MAX_ROWS) throw bad(`too many rows (${incoming.length}).`);

  const id = boardId(event, date, alliance);
  const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
  const { results: had } = board
    ? await env.DB.prepare(
        'SELECT id, place, search, ingame, points, edited FROM scores WHERE board_id = ? ORDER BY place')
        .bind(id).all()
    : { results: [] };

  // The same player, however the two rows spell them: the roster name when there is one, the
  // drawn name when there is not. This is the identity the roster matching already produced —
  // nothing here tries to match names a second time.
  const byIdentity = new Map();
  const byPlace = new Map();
  for (const r of had || []) { byIdentity.set(identity(r), r); byPlace.set(r.place, r); }

  const fresh = [], duplicates = [];
  for (const r of incoming) {
    const was = byIdentity.get(identity(r));
    if (was) duplicates.push({ incoming: r, existing: was });
    else fresh.push(r);
  }

  const preview = {
    board: id, exists: !!board, version: board ? board.version : null,
    label: board ? board.label : label, savedAt: board ? board.saved_at : null,
    total: incoming.length, new: fresh.length, duplicates: duplicates.length,
    existingRows: (had || []).length,
    handEdited: (had || []).filter(r => r.edited).length,
    samples: duplicates.slice(0, 40).map(d => ({
      place: d.incoming.place, name: d.incoming.search || d.incoming.ingame,
      was: d.existing.points, now: d.incoming.points, wasPlace: d.existing.place,
    })),
  };
  // Adding rows to a board is anyone's; replacing it is its sender's or an admin's, and the
  // preview says which, so the dialog offers only what will be allowed.
  preview.canReplace = !board || mayManage(env.user, board);
  preview.owner = board && board.created_by
    ? ((await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(board.created_by).first()) || {}).name || null
    : null;
  if (mode === 'preview') return preview;

  if (board && body.version !== undefined && body.version !== null
      && Number(body.version) !== board.version)
    throw conflict('this board was saved by someone else since you looked at it — check the preview again.',
                   { version: board.version });

  let result;
  if (mode === 'replace' || !board) {
    result = await saveBoard(env, { event, date, alliance, label, rows: incoming,
                                    mode: board ? 'merge' : 'replace' });
    result.added = result.saved;
    result.duplicates = board ? duplicates.length : 0;
  } else {
    const write = mode === 'new' ? fresh : incoming;
    const stamp = now();
    const stmts = [];
    let added = 0, replaced = 0;
    for (const r of write) {
      const at = byPlace.get(r.place);
      const same = byIdentity.get(identity(r));
      const target = at && identity(at) === identity(r) ? at : same || at;
      if (target) {
        // A row somebody corrected by hand is not overwritten by a later reading of the same
        // recording; that is the whole point of the edited flag.
        if (target.edited) continue;
        stmts.push(env.DB.prepare(
          'UPDATE scores SET place = ?, search = ?, ingame = ?, alliance = ?, points = ? WHERE id = ?')
          .bind(r.place, r.search, r.ingame, r.alliance, r.points, target.id));
        replaced++;
      } else {
        stmts.push(env.DB.prepare(
          `INSERT INTO scores (id, board_id, place, search, ingame, alliance, points, edited, extra, sort)
           VALUES (?,?,?,?,?,?,?,0,?,?)`)
          .bind(newId('s'), id, r.place, r.search, r.ingame, r.alliance, r.points, r.extra, r.sort));
        added++;
      }
    }
    stmts.push(env.DB.prepare('UPDATE boards SET version = version + 1, saved_at = ?, label = COALESCE(?, label) WHERE id = ?')
      .bind(stamp, label, id));
    for (const part of chunk(stmts, 40)) await env.DB.batch(part);
    const after = await env.DB.prepare('SELECT version FROM boards WHERE id = ?').bind(id).first();
    result = { board: id, saved: added + replaced, added, replaced,
               duplicates: duplicates.length, kept: 0,
               version: after ? after.version : 1, savedAt: stamp };
  }

  const run = {
    id: newId('run'), created_at: now(), board_id: id, event, date, alliance, label,
    video: nullable(body.video),
    found: incoming.length, added: result.added ?? result.saved, duplicates: duplicates.length,
    frames: toInt(body.frames, null), readings: toInt(body.readings, null),
    status: 'completed', note: nullable(body.note),
  };
  await env.DB.prepare(
    `INSERT INTO extraction_runs (id, created_at, board_id, event, date, alliance, label, video,
                                  found, added, duplicates, frames, readings, status, note, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(run.id, run.created_at, run.board_id, run.event, run.date, run.alliance, run.label,
          run.video, run.found, run.added, run.duplicates, run.frames, run.readings,
          run.status, run.note, env.user ? env.user.id : null).run();
  await logActivity(env, 'extract', 'board:' + id,
    `${run.added} row${run.added === 1 ? '' : 's'} added from an extraction`
    + (duplicates.length ? `, ${duplicates.length} already there` : ''),
    { run: run.id, video: run.video, mode });

  return { ...result, run: run.id, preview };
}

export async function listRuns(env, limit = 60) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM extraction_runs ORDER BY created_at DESC LIMIT ?').bind(Math.min(200, limit)).all();
  return { runs: results || [] };
}

// ---------------------------------------------------------------------------------------
// Relabel, delete, and the row routes the old page still calls
// ---------------------------------------------------------------------------------------
export async function patchBoard(env, id, body) {
  const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
  if (!board) throw notFound('no such board');
  requireManage(env.user, board, 'rename or re-date');
  // Who owns it is an admin's to change: by in-game name, or empty for nobody.
  let owner = board.created_by || null;
  if (body.ownerName !== undefined && body.ownerName !== null) {
    if (!isAdmin(env.user)) throw forbidden('only an admin can change who owns a board.');
    const key = nameKey(body.ownerName);
    if (!key) owner = null;
    else {
      const u = await env.DB.prepare('SELECT id FROM users WHERE name_key = ?').bind(key).first();
      if (!u) throw bad(`no account is called “${str(body.ownerName)}”.`);
      owner = u.id;
    }
  }
  const event = str(body.event ?? board.event);
  const date = str(body.date ?? board.date);
  const alliance = str(body.alliance ?? board.alliance);
  const label = body.label === undefined ? board.label : nullable(body.label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date must be YYYY-MM-DD.');
  if (!alliance) throw bad('alliance is required.');
  const next = boardId(event, date, alliance);
  if (next !== id) {
    const clash = await env.DB.prepare('SELECT id FROM boards WHERE id = ?').bind(next).first();
    if (clash) throw conflict(`a board already exists for ${alliance} on ${date}.`);
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE boards SET id=?, event=?, date=?, alliance=?, label=?, created_by=?, version=version+1 WHERE id=?')
      .bind(next, event, date, alliance, label, owner, id),
    env.DB.prepare('UPDATE scores SET board_id=? WHERE board_id=?').bind(next, id),
    env.DB.prepare('UPDATE board_meta SET board_id=? WHERE board_id=?').bind(next, id),
    env.DB.prepare('UPDATE board_sheets SET board_id=? WHERE board_id=?').bind(next, id),
    env.DB.prepare('UPDATE extraction_runs SET board_id=? WHERE board_id=?').bind(next, id),
  ]);
  return { board: next, renamed: next !== id };
}

export async function deleteBoard(env, id) {
  const board = await env.DB.prepare('SELECT * FROM boards WHERE id = ?').bind(id).first();
  if (!board) throw notFound('no such board');
  requireManage(env.user, board, 'delete');
  const n = await env.DB.prepare('SELECT COUNT(*) n FROM scores WHERE board_id = ?').bind(id).first();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM scores WHERE board_id = ?').bind(id),
    env.DB.prepare('DELETE FROM board_meta WHERE board_id = ?').bind(id),
    env.DB.prepare('DELETE FROM board_sheets WHERE board_id = ?').bind(id),
    env.DB.prepare('DELETE FROM boards WHERE id = ?').bind(id),
  ]);
  await logActivity(env, 'delete-board', 'board:' + id,
    `board deleted — ${board.alliance} on ${board.date}, ${(n && n.n) || 0} rows`);
  return { deleted: id, rows: (n && n.n) || 0 };
}

/** One row corrected by hand, from either the old query-style route or the path one. */
export async function editRow(env, id, place, body) {
  if (!id || !Number.isFinite(place)) throw bad('board and place are required.');
  const row = await env.DB.prepare('SELECT * FROM scores WHERE board_id=? AND place=?')
    .bind(id, place).first();
  if (!row) throw notFound('no such row');
  const search = body.search === undefined ? row.search : nullable(body.search);
  const ingame = body.ingame === undefined ? row.ingame : str(body.ingame);
  const alliance = body.alliance === undefined ? row.alliance : nullable(body.alliance);
  const points = body.points === undefined ? row.points : toInt(body.points, null);
  if (!ingame) throw bad('a name is required.');
  if (points === null) throw bad('points must be a number.');
  await env.DB.batch([
    env.DB.prepare('UPDATE scores SET search=?, ingame=?, alliance=?, points=?, edited=1 WHERE id=?')
      .bind(search, ingame, alliance, points, row.id),
    env.DB.prepare('UPDATE boards SET version = version + 1 WHERE id = ?').bind(id),
  ]);
  return { updated: { place, search, ingame, alliance, points } };
}

export async function addRows(env, id, rows) {
  if (!Array.isArray(rows) || !rows.length) throw bad('rows is required.');
  if (rows.length > MAX_ROWS) throw bad('too many rows.');
  const { results: had } = await env.DB.prepare('SELECT id, place FROM scores WHERE board_id = ?')
    .bind(id).all();
  const byPlace = new Map((had || []).map(r => [r.place, r.id]));
  const stmts = [];
  let n = 0;
  for (const [i, raw] of rows.entries()) {
    const r = normalise(raw, i);
    if (!r) continue;
    const at = byPlace.get(r.place);
    stmts.push(at
      ? env.DB.prepare('UPDATE scores SET search=?, ingame=?, alliance=?, points=?, edited=1 WHERE id=?')
          .bind(r.search, r.ingame, r.alliance, r.points, at)
      : env.DB.prepare(
          `INSERT INTO scores (id, board_id, place, search, ingame, alliance, points, edited, extra, sort)
           VALUES (?,?,?,?,?,?,?,1,?,?)`)
          .bind(newId('s'), id, r.place, r.search, r.ingame, r.alliance, r.points, r.extra, r.sort));
    n++;
  }
  if (!n && !allowEmpty) throw bad('no row had both a rank and a name.');
  stmts.push(env.DB.prepare('UPDATE boards SET version = version + 1 WHERE id = ?').bind(id));
  for (const part of chunk(stmts, 40)) await env.DB.batch(part);
  return { added: n, board: id };
}

export async function deleteRowAt(env, id, place) {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM scores WHERE board_id = ? AND place = ?').bind(id, place),
    env.DB.prepare('UPDATE boards SET version = version + 1 WHERE id = ?').bind(id),
  ]);
  const changes = (r && r[0] && r[0].meta && r[0].meta.changes) || 0;
  if (!changes) throw notFound('no such row');
  return { deleted: place, board: id };
}
