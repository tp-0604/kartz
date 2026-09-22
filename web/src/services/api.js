/**
 * One door to the Worker.
 *
 * The dialog is a page on googleusercontent.com, so every call to the Worker is cross-origin
 * and has to prove itself. The proof is the shared phrase, which is kept in the spreadsheet's
 * own properties and handed to this page at startup by Apps Script — it is never stored in the
 * browser and never written into the bundle. Only somebody who can already edit the
 * spreadsheet can open the dialog at all, so the phrase never reaches anyone who did not
 * already have it.
 *
 * The Worker does two things now: it holds the model key, and it answers questions about what
 * is on the sheet. Everything else it used to do went with the database.
 */

let base = '';
let pass = '';

/** Told to the page once, by Apps Script, before anything else happens. */
export function useWorker({ url, pass: phrase }) {
  base = String(url || '').replace(/\/+$/, '');
  pass = String(phrase || '');
}

export const apiBase = () => base;
export const hasWorker = () => !!base;
export const apiUrl = path => base + path;
export const apiHeaders = (h = {}) => ({ ...h, ...(pass ? { 'x-kartz-pass': pass } : {}) });

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export async function api(path, opts = {}) {
  if (!base) throw new ApiError(0, 'The Worker address has not been set. Open Kartz → Settings.');
  const res = await fetch(apiUrl(path), { ...opts, headers: apiHeaders(opts.headers || {}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (body.error && body.error.message) || body.error
      || (res.status === 403
        ? 'the Worker refused this spreadsheet — check the shared phrase in Kartz → Settings'
        : `request failed (${res.status})`);
    throw new ApiError(res.status, message, body);
  }
  return body;
}

const json = (method, body) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/** Whether the Worker has a model key, and which model it would use. */
export const aiStatus = () => api('/ai/status');

/** A question about what is on the sheet. The rows travel with it; nothing is stored. */
export const ask = body => api('/ai/ask', json('POST', body));

/** Reading a recording is a model call by another name, and goes through the same proxy. */
export const ping = () => api('/ai/status');
