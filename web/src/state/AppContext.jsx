// What every screen shares: the roster, the saved boards, the aliases Remember my fixes
// stored, and the handoff from the extractor to the sheet.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../utils/storage.js';
import * as API from '../services/api.js';
import { today } from '../utils/format.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const TABS = [
  { id: 'extract', label: 'Extract', hint: 'recording → rows' },
  { id: 'sheet',   label: 'Sheet',   hint: 'review, edit, save' },
  { id: 'history', label: 'History', hint: 'every board saved' },
  { id: 'roster',  label: 'Roster',  hint: 'who is who' },
];
const tabFromHash = () => {
  const h = (location.hash || '').replace(/^#/, '').split('/')[0];
  if (h === 'database') return 'history';                  // the old page's link
  return TABS.some(t => t.id === h) ? h : (store.get('tab') || 'extract');
};

const EMPTY_META = { columns: [], labels: [], version: 0, savedAt: null, sheet: null };

// The roster is read from the database, and mirrored into this browser as it arrives. The
// mirror is not a second source of truth: it is what the extractor matches against when the
// phone is on a bad connection, and it is replaced whole every time the real thing loads.
const loadMirror = () => {
  const m = store.get('roster');
  if (Array.isArray(m)) return { rows: m, meta: EMPTY_META };
  if (m && Array.isArray(m.rows)) return { rows: m.rows, meta: { ...EMPTY_META, ...(m.meta || {}) } };
  // a mirror written by the version that pulled from Google Sheets
  if (m && Array.isArray(m.all))
    return { rows: m.all.map(r => ({ search: r.search, ingame: r.ingame, alliance: r.alliance, extra: {} })), meta: EMPTY_META };
  return { rows: [], meta: EMPTY_META };
};

export function AppProvider({ children }) {
  const [tab, setTab] = useState(tabFromHash);
  const mirror = useRef(loadMirror());
  const [roster, setRoster] = useState(mirror.current.rows);
  const [rosterMeta, setRosterMeta] = useState(mirror.current.meta);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [aliases, setAliasesState] = useState(() => store.get('aliases') || {});
  const [date, setDateState] = useState(() => store.get('datestr') || today());
  const [boards, setBoards] = useState([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [staged, setStaged] = useState(null);
  const [notice, setNotice] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const noticeTimer = useRef(null);

  // ---- navigation: the hash is the address, and the last screen is remembered --------------
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback(t => {
    setTab(t);
    store.set('tab', t);
    try { history.replaceState(null, '', '#' + t); } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // ---- a one-line notice, anywhere ---------------------------------------------------------
  const notify = useCallback((text, kind = 'ok', ms = 3200) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, kind });
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);

  // ---- the roster ---------------------------------------------------------------------------
  const applyRoster = useCallback(j => {
    const meta = { columns: j.columns || [], labels: j.labels || [], version: j.version || 0,
                   savedAt: j.savedAt || null, sheet: j.sheet || null };
    setRoster(j.rows || []);
    setRosterMeta(meta);
    setRosterLoaded(true);
    // the mirror keeps the rows and the headings, never the workbook: a snapshot is large and
    // the extractor has no use for it
    store.set('roster', { rows: j.rows || [], meta: { ...meta, sheet: null } });
    return { rows: j.rows || [], meta };
  }, []);

  const loadRoster = useCallback(async () => applyRoster(await API.loadRoster()), [applyRoster]);

  const saveRoster = useCallback(async body => {
    const out = await API.saveRoster(body);
    applyRoster({ rows: body.rows, columns: body.columns, labels: body.labels,
                  version: out.version, savedAt: new Date().toISOString(), sheet: null });
    return out;
  }, [applyRoster]);

  useEffect(() => { loadRoster().catch(() => setRosterLoaded(true)); }, [loadRoster]);

  // What the matcher runs on: three fields, and nothing it does not use.
  const matchRoster = useMemo(
    () => roster.map(r => ({ search: r.search, ingame: r.ingame || r.search, alliance: r.alliance || '' })),
    [roster]);

  // ---- small persisted things ----------------------------------------------------------------
  const setAliases = useCallback(a => { setAliasesState(a); store.set('aliases', a); }, []);
  const setDate = useCallback(d => { setDateState(d); store.set('datestr', d); }, []);

  // ---- boards --------------------------------------------------------------------------------
  const refreshBoards = useCallback(async () => {
    try {
      const j = await API.listBoards();
      setBoards(j.boards || []);
      setBoardsLoaded(true);
      return j.boards || [];
    } catch (e) {
      setBoardsLoaded(true);
      throw e;
    }
  }, []);
  useEffect(() => { refreshBoards().catch(() => {}); }, [refreshBoards]);

  // ---- the handoff: extractor (or history) → sheet ------------------------------------------
  const stage = useCallback(payload => { setStaged({ ...payload, at: Date.now() }); go('sheet'); }, [go]);
  const clearStaged = useCallback(() => setStaged(null), []);

  const value = {
    tab, go, notify, notice,
    setupOpen, setSetupOpen,
    roster, rosterMeta, rosterLoaded, matchRoster, loadRoster, saveRoster,
    aliases, setAliases, date, setDate,
    boards, boardsLoaded, refreshBoards,
    staged, stage, clearStaged,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
