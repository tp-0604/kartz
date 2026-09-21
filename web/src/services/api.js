// One door to the Worker.
//
// In development Vite proxies /api to `wrangler dev`, and when the Worker serves the site the
// two share an origin, so the base is simply /api. On GitHub Pages the API lives on another
// origin, named at build time, and every request carries the shared phrase the Worker was
// given — that is what lets a cross-origin caller in. The phrase is typed once on the Setup
// screen and kept in this browser; it never appears in the bundle.
const BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');

export const isCrossOrigin = () => /^https?:/i.test(BASE) && !BASE.startsWith(location.origin);
export const apiBase = () => BASE;

export const getPass = () => { try { return localStorage.getItem('kartz.pass') || ''; } catch { return ''; } };
export const setPass = v => { try { v ? localStorage.setItem('kartz.pass', v) : localStorage.removeItem('kartz.pass'); } catch { /* ignore */ } };

// The signed-in session: a token the Worker issued at sign-in, kept in this browser only.
export const getSession = () => { try { return localStorage.getItem('kartz.session') || ''; } catch { return ''; } };
export const setSession = v => { try { v ? localStorage.setItem('kartz.session', v) : localStorage.removeItem('kartz.session'); } catch { /* ignore */ } };

export const apiUrl = path => BASE + path;
export const apiHeaders = (h = {}) => {
  const pass = getPass(), session = getSession();
  return { ...h, ...(pass ? { 'x-kartz-pass': pass } : {}), ...(session ? { 'x-kartz-session': session } : {}) };
};

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), { ...opts, headers: apiHeaders(opts.headers || {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A session the Worker no longer knows — expired, or signed out elsewhere — sends the app back
    // to the sign-in screen, rather than failing one request at a time.
    if (res.status === 401 && getSession()) {
      setSession('');
      window.dispatchEvent(new Event('kartz:signedout'));
    }
    const msg =(j.error && j.error.message) || j.error
      || (res.status === 403 ? 'the Worker refused this browser — set the shared phrase on the Setup screen'
                             : 'request failed (' + res.status + ')');
    throw new ApiError(res.status, msg, j);
  }
  return j;
}

const json = (method, body) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// ---- datasets: what the workspace opens, and the operations it sends back ----------------
//
// A dataset is the roster or one board. Reading gives columns, rows and a version; writing is a
// batch of operations against that version, so a save made on a stale copy is refused rather
// than landing on top of somebody else's.
export const listDatasets = () => api('/datasets');
export const loadDataset = key => api('/datasets/' + encodeURIComponent(key));
export const applyOps = (key, body) => api('/datasets/' + encodeURIComponent(key) + '/ops', json('POST', body));
// The workbook "Open in spreadsheet" keeps beside the rows: formulas and formatting. Handed back
// only while the rows are still the version it was saved with.
export const loadSheet = key => api('/datasets/' + encodeURIComponent(key) + '/sheet');
export const saveSheet = (key, body) => api('/datasets/' + encodeURIComponent(key) + '/sheet', json('PUT', body));

// ---- accounts ---------------------------------------------------------------------------------
export const signUp = body => api('/auth/signup', json('POST', body));
export const signIn = body => api('/auth/signin', json('POST', body));
export const signOut = () => api('/auth/signout', json('POST', {}));
export const whoAmI = () => api('/auth/me');
// The accounts. Any admin may read them; only the owner may change a role or remove one.
export const listUsers = () => api('/users');
export const setUserRole = (id, role) => api('/users/' + encodeURIComponent(id), json('PATCH', { role }));
export const removeUser = id => api('/users/' + encodeURIComponent(id), { method: 'DELETE' });

// ---- files: folders, workbooks, tabs, and the grid --------------------------------------------
//
// The tree is one small answer for the whole app — every folder and every file, with the face
// of each. A tab's grid comes down a band at a time, still compressed, and is unzipped here.
export const tree = () => api('/tree');
export const makeFolder = body => api('/folders', json('POST', body));
export const renameFolder = (id, name) => api('/folders/' + encodeURIComponent(id), json('PATCH', { name }));
export const deleteFolder = id => api('/folders/' + encodeURIComponent(id), { method: 'DELETE' });

export const makeFile = body => api('/files', json('POST', body));
export const readFile = id => api('/files/' + encodeURIComponent(id));
export const patchFile = (id, body) => api('/files/' + encodeURIComponent(id), json('PATCH', body));
export const deleteFile = id => api('/files/' + encodeURIComponent(id), { method: 'DELETE' });
export const putStyles = (id, styles) => api('/files/' + encodeURIComponent(id) + '/styles', json('PUT', { styles }));
export const addSheet = (id, body) => api('/files/' + encodeURIComponent(id) + '/sheets', json('POST', body));
export const finishFile = (id, report) => api('/files/' + encodeURIComponent(id) + '/done', json('POST', { report }));

export const patchSheet = (id, body) => api('/sheets/' + encodeURIComponent(id), json('PATCH', body));
export const deleteSheet = id => api('/sheets/' + encodeURIComponent(id), { method: 'DELETE' });
export const putSlab = (id, body) => api('/sheets/' + encodeURIComponent(id) + '/slab', json('PUT', body));
export const sheetMeta = id => api('/sheets/' + encodeURIComponent(id) + '/meta');
export const putSheetMeta = (id, kind, data) =>
  api('/sheets/' + encodeURIComponent(id) + '/meta', json('PUT', { kind, json: data }));
export const sheetCells = (id, from, to) =>
  api(`/sheets/${encodeURIComponent(id)}/cells?from=${from | 0}&to=${to | 0}`);

export const haveAssets = ids => api('/assets/have', json('POST', { ids }));
export const assetUrl = id => apiUrl('/assets/' + encodeURIComponent(id));
export const putAsset = (id, bytes, mime) => api('/assets/' + encodeURIComponent(id),
  { method: 'PUT', headers: { 'content-type': mime }, body: bytes });

// ---- extraction into the database -----------------------------------------------------------
// mode 'preview' writes nothing and says what would happen; the rest commit.
export const commit = body => api('/commit', json('POST', body));
export const listRuns = () => api('/runs');

// ---- the trail, and saved views ---------------------------------------------------------------
export const activity = (limit = 80) => api('/activity?limit=' + limit);
export const listViews = dataset => api('/views' + (dataset ? '?dataset=' + encodeURIComponent(dataset) : ''));
export const saveView = body => api('/views', json('POST', body));
export const deleteView = id => api('/views/' + encodeURIComponent(id), { method: 'DELETE' });

// ---- the analyst ---------------------------------------------------------------------------------
// Both of these are allowed to be unavailable. Nothing else in the app depends on them.
export const aiStatus = () => api('/ai/status');
export const aiAsk = body => api('/ai/ask', json('POST', body));

// ---- boards -----------------------------------------------------------------------------
export const listBoards  = () => api('/boards');
export const loadBoard   = id => api('/boards/' + encodeURIComponent(id));
export const createBoard = body => api('/boards', json('POST', body));
export const saveBoard   = (id, body) => api('/boards/' + encodeURIComponent(id), json('PUT', body));
export const patchBoard  = (id, body) => api('/boards/' + encodeURIComponent(id), json('PATCH', body));
export const deleteBoard = id => api('/boards/' + encodeURIComponent(id), { method: 'DELETE' });
export const patchRow    = (id, place, body) =>
  api('/boards/' + encodeURIComponent(id) + '/rows/' + place, json('PATCH', body));
export const deleteRow   = (id, place) =>
  api('/boards/' + encodeURIComponent(id) + '/rows/' + place, { method: 'DELETE' });
// the extractor's own save: replaces the board, keeps rows somebody corrected by hand
export const saveRun     = body => api('/runs', json('POST', body));
export const addRows     = (id, rows) =>
  api('/boards/' + encodeURIComponent(id) + '/rows', json('POST', { rows }));

// ---- reading across boards ---------------------------------------------------------------
export const monthView = (month, alliance) =>
  api('/month?month=' + encodeURIComponent(month) + (alliance ? '&alliance=' + encodeURIComponent(alliance) : ''));
export const playerView = search => api('/player?search=' + encodeURIComponent(search));
export const allRows = () => api('/all');

// ---- the roster --------------------------------------------------------------------------
// The whole list, read and written at once, the way a spreadsheet is saved.
export const loadRoster = () => api('/roster/rows');
export const saveRoster = body => api('/roster/rows', json('PUT', body));

// A cheap "is the Worker there and does it accept this browser" probe for the Setup screen.
export const ping = () => api('/boards');
