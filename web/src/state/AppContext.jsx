// What every screen shares: the roster (sheet plus corrections), the saved boards, the
// aliases Remember my fixes stored, and the handoff from the extractor to the sheet.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../utils/storage.js';
import { ROSTER_SHEET } from '../extractor/config.js';
import { pullRoster as pullSheet } from '../extractor/roster.js';
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

// The roster as the app actually uses it: the sheet, with this database's corrections applied.
// Storing the difference rather than a copy is what lets Pull from sheet stay safe to press —
// it brings in new players without undoing a single correction.
export function mergeRoster(cache, edits) {
  const base = (cache && cache.all) || [];
  const seen = new Set(), out = [];
  for (const r of base) {
    const e = edits.get(r.search);
    seen.add(r.search);
    if (e && e.removed) continue;
    out.push({ search: r.search,
               ingame:   (e && e.ingame)   || r.ingame,
               alliance: (e && e.alliance) || r.alliance,
               cells: r.cells,
               fromSheet: { ingame: r.ingame, alliance: r.alliance },
               src: e ? 'edited' : 'sheet' });
  }
  for (const [k, e] of edits)
    if (e.added && !e.removed && !seen.has(k))
      out.push({ search: k, ingame: e.ingame || k, alliance: e.alliance || '',
                 cells: null, fromSheet: null, src: 'added' });
  return out.sort((a, b) => a.search.localeCompare(b.search, undefined, { sensitivity: 'base' }));
}

const loadCache = () => {
  let c = store.get('roster') || null;
  // A roster cached by an earlier version was stored already split. Put it back together.
  if (c && !c.all) c = { all: [...(c.active || []), ...(c.skipped || [])], cols: null };
  return c;
};

export function AppProvider({ children }) {
  const [tab, setTab] = useState(tabFromHash);
  const [rosterCache, setRosterCache] = useState(loadCache);
  const [rosterEdits, setRosterEdits] = useState(() => new Map());
  const [editsLoaded, setEditsLoaded] = useState(false);
  const [aliases, setAliasesState] = useState(() => store.get('aliases') || {});
  const [date, setDateState] = useState(() => store.get('datestr') || today());
  const [boards, setBoards] = useState([]);
  const [boardsLoaded, setBoardsLoaded] = useState(false);
  const [staged, setStaged] = useState(null);
  const [notice, setNotice] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const noticeTimer = useRef(null);

  // ---- navigation: the hash is the address, and the last tab is remembered ----------------
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

  // ---- roster -------------------------------------------------------------------------------
  const loadEdits = useCallback(async () => {
    try {
      const j = await API.rosterEdits();
      setRosterEdits(new Map((j.edits || []).map(e => [e.search, e])));
    } catch { /* offline, or the Worker refused: the sheet alone still works */ }
    setEditsLoaded(true);
  }, []);
  useEffect(() => { loadEdits(); }, [loadEdits]);

  const pullRoster = useCallback(async () => {
    const c = await pullSheet(ROSTER_SHEET);
    setRosterCache(c);
    store.set('roster', c);
    return c;
  }, []);

  const putRosterEdit = useCallback(async (search, patch) => {
    const cur = rosterEdits.get(search) || {};
    const body = { search,
      ingame:   patch.ingame   !== undefined ? patch.ingame   : cur.ingame,
      alliance: patch.alliance !== undefined ? patch.alliance : cur.alliance,
      added:    patch.added    !== undefined ? patch.added    : (cur.added || 0),
      removed:  patch.removed  !== undefined ? patch.removed  : (cur.removed || 0) };
    const j = await API.putRosterEdit(body);
    if (j.edit) setRosterEdits(m => new Map(m).set(search, j.edit));
  }, [rosterEdits]);

  const revertRosterEdit = useCallback(async search => {
    await API.revertRosterEdit(search);
    setRosterEdits(m => { const n = new Map(m); n.delete(search); return n; });
  }, []);

  const roster = useMemo(() => mergeRoster(rosterCache, rosterEdits), [rosterCache, rosterEdits]);
  const matchRoster = useMemo(() => roster.map(r => ({ search: r.search, ingame: r.ingame, alliance: r.alliance })), [roster]);

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
  // { kind: 'records', meta, records } from the extractor, { kind: 'board', id } from history.
  const stage = useCallback(payload => { setStaged({ ...payload, at: Date.now() }); go('sheet'); }, [go]);
  const clearStaged = useCallback(() => setStaged(null), []);

  const value = {
    tab, go, notify, notice,
    setupOpen, setSetupOpen,
    rosterCache, roster, matchRoster, rosterEdits, editsLoaded, pullRoster, putRosterEdit, revertRosterEdit, loadEdits,
    aliases, setAliases, date, setDate,
    boards, boardsLoaded, refreshBoards,
    staged, stage, clearStaged,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
