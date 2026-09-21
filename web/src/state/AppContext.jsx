// What the two halves of the application share: the roster the extractor matches against, the
// list of datasets the workspace navigates, the aliases "remember my fixes" stored, and the one
// handoff between them — Extract saying "open this board in Data".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../utils/storage.js';
import * as API from '../services/api.js';
import { today } from '../utils/format.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// Where the app is: the canvas, or one of the two sheets over it. The hash is the address.
export const MODES = [
  { id: 'home',    label: 'Boards',  hint: 'the month canvas' },
  { id: 'extract', label: 'Extract', hint: 'recording → rows' },
  { id: 'data',    label: 'Data',    hint: 'a board, the roster or a view' },
  { id: 'files',   label: 'Files',   hint: 'folders, workbooks and their tabs' },
];

const modeFromHash = () => {
  const h = (location.hash || '').replace(/^#/, '').split('/')[0];
  // The old app's four screens all live inside these two now.
  if (h === 'sheet' || h === 'history' || h === 'roster' || h === 'database') return 'data';
  return MODES.some(m => m.id === h) ? h : 'home';
};

const EMPTY_META = { columns: [], mapping: {}, version: 0, savedAt: null };

// The roster is read from the database and mirrored into this browser as it arrives. The mirror
// is not a second source of truth: it is what the extractor matches against when the phone is on
// a bad connection, and it is replaced whole every time the real thing loads.
const loadMirror = () => {
  const m = store.get('roster');
  if (Array.isArray(m)) return { rows: m, meta: EMPTY_META };
  if (m && Array.isArray(m.rows)) return { rows: m.rows, meta: { ...EMPTY_META, ...(m.meta || {}) } };
  if (m && Array.isArray(m.all))
    return { rows: m.all.map(r => ({ search: r.search, ingame: r.ingame, alliance: r.alliance, extra: {} })),
             meta: EMPTY_META };
  return { rows: [], meta: EMPTY_META };
};

export function AppProvider({ children }) {
  const [mode, setMode] = useState(modeFromHash);
  const mirror = useRef(loadMirror());
  const [roster, setRoster] = useState(mirror.current.rows);
  const [rosterMeta, setRosterMeta] = useState(mirror.current.meta);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [aliases, setAliasesState] = useState(() => store.get('aliases') || {});
  const [date, setDateState] = useState(() => store.get('datestr') || today());
  const [datasets, setDatasets] = useState(null);
  const [notice, setNotice] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openTarget, setOpenTarget] = useState(null);
  // Handoffs between the canvas, the menu and the sheets: a recording dropped on the canvas, for
  // the extractor; and 'board' or 'file', for the workspace to open its import dialog.
  const [pendingFiles, setPendingFiles] = useState(null);
  const [importRequest, setImportRequest] = useState(null);
  // What the AI is told the screen shows: set by the workspace while a board is open.
  const [aiContext, setAiContext] = useState(null);

  // The file tree: every folder and every file, with the face of each. One small answer that
  // the rail, the section wall and the command palette all read from, loaded once per session.
  const [tree, setTree] = useState(null);
  const [treeError, setTreeError] = useState(null);
  // Where you are inside the files: a section, and a file open in it.
  const [section, setSection] = useState(null);
  const [fileOpen, setFileOpen] = useState(null);

  // ---- who is signed in. Nothing below loads until somebody is -------------------------------
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(() => !API.getSession());
  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('kartz:signedout', out);
    if (API.getSession()) {
      API.whoAmI()
        .then(j => { if (j.user) setUser(j.user); else API.setSession(''); })
        .catch(() => { /* offline or refused: the sign-in screen says what to do */ })
        .finally(() => setAuthChecked(true));
    }
    return () => window.removeEventListener('kartz:signedout', out);
  }, []);
  const acceptSession = useCallback(out => { API.setSession(out.token); setUser(out.user); }, []);
  const signOut = useCallback(async () => {
    try { await API.signOut(); } catch { /* signed out on this device either way */ }
    API.setSession('');
    setUser(null);
  }, []);
  const userId = user ? user.id : null;
  const noticeTimer = useRef(null);

  // ---- navigation: the hash is the address, and the last mode is remembered ------------------
  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback(m => {
    setMode(m);
    try {
      history.replaceState(null, '', m === 'home' ? location.pathname + location.search : '#' + m);
    } catch { /* ignore */ }
  }, []);

  // ---- a one-line notice, anywhere -------------------------------------------------------------
  const notify = useCallback((text, kind = 'ok', ms = 3200) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, kind });
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);

  // ---- the roster --------------------------------------------------------------------------------
  const loadRoster = useCallback(async () => {
    const j = await API.loadRoster();
    const meta = { columns: j.columns || [], mapping: j.mapping || {}, version: j.version || 0,
                   savedAt: j.savedAt || null };
    setRoster(j.rows || []);
    setRosterMeta(meta);
    setRosterLoaded(true);
    store.set('roster', { rows: j.rows || [], meta });
    return j;
  }, []);
  useEffect(() => { if (userId) loadRoster().catch(() => setRosterLoaded(true)); }, [loadRoster, userId]);

  // What the matcher runs on: three fields, and nothing it does not use.
  const matchRoster = useMemo(
    () => roster.map(r => ({ search: r.search, ingame: r.ingame || r.search, alliance: r.alliance || '' })),
    [roster]);

  // ---- small persisted things -----------------------------------------------------------------------
  const setAliases = useCallback(a => { setAliasesState(a); store.set('aliases', a); }, []);
  const setDate = useCallback(d => { setDateState(d); store.set('datestr', d); }, []);

  // ---- the datasets the workspace navigates -----------------------------------------------------------
  const refreshDatasets = useCallback(async () => {
    try {
      const j = await API.listDatasets();
      setDatasets(j);
      return j;
    } catch {
      setDatasets(d => d || { roster: { key: 'roster', kind: 'roster', title: 'Roster', rows: 0 }, boards: [] });
      return null;
    }
  }, []);
  useEffect(() => { if (userId) refreshDatasets(); }, [refreshDatasets, userId]);

  const boards = datasets ? datasets.boards : [];

  const refreshTree = useCallback(async () => {
    try {
      const out = await API.tree();
      setTree(out);
      setTreeError(null);
      return out;
    } catch (e) {
      setTreeError(e.message || String(e));
      return null;
    }
  }, []);

  /** Open a section, or a file inside one. Both keep the rail where it is. */
  const openSection = useCallback(id => {
    setSection(id);
    setFileOpen(null);
    go('files');
  }, [go]);

  const openFile = useCallback((id, sheetIdx = 0) => {
    setFileOpen({ id, sheetIdx });
    go('files');
  }, [go]);

  /** Extract → Data: open this dataset, in that mode. */
  const openInData = useCallback(target => {
    setOpenTarget(target);
    go('data');
  }, [go]);

  const value = {
    mode, go, notify, notice,
    setupOpen, setSetupOpen, paletteOpen, setPaletteOpen,
    roster, rosterMeta, rosterLoaded, matchRoster, loadRoster,
    aliases, setAliases, date, setDate,
    datasets, boards, refreshDatasets,
    openTarget, setOpenTarget, openInData,
    pendingFiles, setPendingFiles, importRequest, setImportRequest,
    user, authChecked, acceptSession, signOut, aiContext, setAiContext,
    tree, treeError, refreshTree, section, openSection, fileOpen, openFile, setFileOpen,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
