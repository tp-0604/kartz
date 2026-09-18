// The small things every route needs.

export const now = () => new Date().toISOString();

// crypto.randomUUID exists in Workers; the fallback is for a runtime that lacks it.
export function newId(prefix = 'r') {
  const u = (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix + '_' + u.replace(/-/g, '').slice(0, 20);
}

export const str = v => (v === null || v === undefined ? '' : String(v)).trim();
export const nullable = v => { const s = str(v); return s || null; };

/** A number as a spreadsheet writes one: 12,345 and " 12 345 " are both 12345. */
export function toInt(v, fallback = null) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : fallback;
  const s = str(v).replace(/[,\s]/g, '');
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { const out = JSON.parse(v); return out === null ? fallback : out; } catch { return fallback; }
}

/** Identity for "is this the same player": the roster name if there is one, else the drawn name. */
export const identity = row =>
  (str(row.search) || str(row.ingame)).toLowerCase().replace(/\s+/g, ' ');

/**
 * What changed, to what, when. Traceability rather than version control, so it is one row and
 * never blocks the write it describes.
 */
export async function logActivity(env, kind, dataset, summary, detail) {
  // The request's env carries who is signed in (see worker.js), so every line says who.
  const u = env.user || null;
  try {
    await env.DB.prepare(
      'INSERT INTO activity (at, kind, dataset, summary, detail, actor_id, actor_name) VALUES (?,?,?,?,?,?,?)')
      .bind(now(), kind, dataset || null, summary, detail ? JSON.stringify(detail) : null,
            u ? u.id : null, u ? u.name : null).run();
  } catch { /* the log is not worth failing a save over */ }
}

/** The same statement, but as a batch — D1 caps a single statement's bound parameters at 100. */
export const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
export const bad = (message, extra) => new HttpError(400, message, extra);
export const notFound = message => new HttpError(404, message);
export const conflict = (message, extra) => new HttpError(409, message, extra);
