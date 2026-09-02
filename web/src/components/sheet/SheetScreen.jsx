// The workbook, and the one bar above it that says which board this is and whether it is
// saved. Undo and redo live in the workbook and never reach the network; the database sees
// the sheet only when Save is pressed, as one atomic replacement of the board.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import SheetWorkspace from './SheetWorkspace.jsx';
import { toRecords, validate } from '../../sheet/columns.js';
import { createBoard, loadBoard, patchBoard, saveBoard, ApiError } from '../../services/api.js';
import { DAYS, MAIN_ALLIANCES } from '../../extractor/config.js';
import { store } from '../../utils/storage.js';
import { fmtTime } from '../../utils/format.js';
import { AllianceChip } from '../shared/ui.jsx';

const draftKey = meta => 'draft.' + (meta.id || `new|${meta.date}|${meta.alliance}`);
const NEW_META = date => ({ id: null, date, alliance: '', label: DAYS[0], version: null, savedAt: null });

export default function SheetScreen() {
  const { staged, clearStaged, boards, refreshBoards, notify, date: defaultDate } = useApp();
  const [ctl, setCtl] = useState(null);
  const ctlRef = useRef(null);
  const [meta, setMeta] = useState(() => NEW_META(defaultDate));
  const [loadedAs, setLoadedAs] = useState(null);         // { date, alliance } the board was opened as
  const [baseline, setBaseline] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');                    // '', 'loading', 'saving'
  const [problems, setProblems] = useState([]);
  const [draft, setDraft] = useState(null);
  const draftTimer = useRef(null);
  const metaRef = useRef(meta); metaRef.current = meta;

  const onReady = useCallback(c => { ctlRef.current = c; setCtl(c); }, []);

  useEffect(() => {
    if (!ctl) return;
    setDirty(ctl.isDirty());
    return ctl.onDirty(setDirty);
  }, [ctl]);

  // A local draft two seconds after the last change, so a closed tab costs nothing.
  useEffect(() => {
    if (!ctl) return;
    clearTimeout(draftTimer.current);
    if (!dirty) return;
    draftTimer.current = setTimeout(() => {
      try { store.set(draftKey(metaRef.current), { at: new Date().toISOString(), meta: metaRef.current, snapshot: ctl.snapshot() }); }
      catch { /* a snapshot that cannot be stored is not worth failing over */ }
    }, 2000);
    return () => clearTimeout(draftTimer.current);
  }, [dirty, ctl, meta]);

  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const openBoard = useCallback(async id => {
    const c = ctlRef.current; if (!c) return;
    setBusy('loading'); setProblems([]);
    try {
      const j = await loadBoard(id);
      const b = j.board;
      if (j.sheet) c.restore(j.sheet); else c.loadRows(j.rows);
      const m = { id: b.id, date: b.date, alliance: b.alliance, label: b.label || '', version: j.version, savedAt: b.saved_at };
      setMeta(m); setLoadedAs({ date: b.date, alliance: b.alliance });
      setBaseline(j.rows);
      const d = store.get(draftKey(m));
      setDraft(d && d.at > (b.saved_at || '') ? d : null);
    } catch (e) { notify('Could not open that board: ' + e.message, 'bad'); }
    finally { setBusy(''); }
  }, [notify]);

  const startNew = useCallback((m = NEW_META(defaultDate)) => {
    const c = ctlRef.current; if (!c) return;
    c.reset();
    setMeta(m); setLoadedAs(null); setBaseline([]); setProblems([]); setDraft(null);
  }, [defaultDate]);

  useEffect(() => {
    if (!ctl || !staged) return;
    if (staged.kind === 'records') {
      ctl.loadRows(staged.records);
      const m = { ...NEW_META(staged.meta.date || defaultDate), ...staged.meta, id: null, version: null };
      setMeta(m); setLoadedAs(null); setBaseline(staged.records); setProblems([]); setDraft(null);
      ctl.markDirty();
    } else if (staged.kind === 'board') {
      openBoard(staged.id);
    }
    clearStaged();
  }, [ctl, staged, clearStaged, openBoard, defaultDate]);

  const save = async () => {
    const c = ctlRef.current; if (!c) return;
    if (!meta.alliance) { notify('Choose the alliance this board belongs to.', 'warn'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) { notify('Choose a date.', 'warn'); return; }
    const sheetRows = c.readRows();
    const probs = validate(sheetRows);
    if (probs.length) { setProblems(probs); notify('Fix the rows listed above the sheet, then save.', 'warn'); return; }
    setProblems([]);
    const records = toRecords(sheetRows, baseline);
    if (!records.length) { notify('There are no rows to save.', 'warn'); return; }
    const snapshot = c.snapshot();
    setBusy('saving');
    try {
      let id = meta.id, version = meta.version;
      if (id && loadedAs && (loadedAs.date !== meta.date || loadedAs.alliance !== meta.alliance)) {
        const r = await patchBoard(id, { date: meta.date, alliance: meta.alliance, label: meta.label || null });
        id = r.board; version = null;
      }
      let out;
      if (id) {
        out = await saveBoard(id, { rows: records, sheet: snapshot, version, label: meta.label || null });
      } else {
        const body = { date: meta.date, alliance: meta.alliance, label: meta.label || null, rows: records, sheet: snapshot };
        try { out = await createBoard(body); }
        catch (e) {
          if (!(e instanceof ApiError && e.status === 409)) throw e;
          if (!window.confirm(`A ${meta.alliance} board for ${meta.date} is already saved. Replace it with this sheet?`)) { setBusy(''); return; }
          out = await createBoard({ ...body, replace: true });
        }
      }
      const m = { ...meta, id: out.board, version: out.version, savedAt: new Date().toISOString() };
      setMeta(m); setLoadedAs({ date: m.date, alliance: m.alliance });
      setBaseline(records.map(r => ({ ...r })));
      store.del(draftKey(meta)); store.del(draftKey(m)); setDraft(null);
      c.markClean();
      refreshBoards().catch(() => {});
      notify(`Saved ${out.saved} rows for ${m.alliance} on ${m.date} ✓`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        notify(e.message + (e.body && e.body.version ? ` (now version ${e.body.version})` : ''), 'bad', 6000);
      else notify('Could not save: ' + e.message, 'bad', 6000);
    } finally { setBusy(''); }
  };

  const leaveOk = () => !dirty || window.confirm('This sheet has unsaved changes. Leave them behind?');
  const chooseBoard = id => { if (!leaveOk()) return; if (!id) startNew(); else openBoard(id); };
  const restoreDraft = () => {
    const c = ctlRef.current; if (!c || !draft) return;
    c.restore(draft.snapshot); c.markDirty();
    setMeta(m => ({ ...m, label: draft.meta.label ?? m.label }));
    setDraft(null);
    notify('Draft restored — press Save to keep it.');
  };

  const alliances = [...new Set([...MAIN_ALLIANCES, ...boards.map(b => b.alliance)])];
  const boardLabel = b => `${b.date} · ${b.alliance}${b.label ? ' · ' + b.label : ''} (${b.players})`;
  const status = !meta.id ? 'new board, not in the database yet'
               : dirty ? `unsaved changes · last saved ${fmtTime(meta.savedAt)}`
               : `saved ${fmtTime(meta.savedAt)} · version ${meta.version}`;

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>Sheet</h1>
          <p>Columns A to E are the record. Anything you add to the right is kept with the sheet.</p>
        </div>
      </div>

      <div className="sheetbar">
        <div className="field">
          <label className="label" htmlFor="pickboard">Board</label>
          <select id="pickboard" value={meta.id || ''} onChange={e => chooseBoard(e.target.value)} disabled={!!busy}>
            <option value="">{meta.id ? 'New board…' : 'New board'}</option>
            {boards.map(b => <option key={b.id} value={b.id}>{boardLabel(b)}{b.has_sheet ? ' ▤' : ''}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="bdate">Date</label>
          <input id="bdate" type="date" value={meta.date}
                 onChange={e => { setMeta(m => ({ ...m, date: e.target.value })); if (ctl) ctl.markDirty(); }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="balli">Alliance</label>
          <select id="balli" value={meta.alliance}
                  onChange={e => { setMeta(m => ({ ...m, alliance: e.target.value })); if (ctl) ctl.markDirty(); }}>
            <option value="">choose…</option>
            {alliances.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="bday">Scoring day</label>
          <select id="bday" value={meta.label || ''}
                  onChange={e => { setMeta(m => ({ ...m, label: e.target.value })); if (ctl) ctl.markDirty(); }}>
            <option value="">—</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="sheetbar__actions">
          <button className="btn btn--icon" title="Undo" onClick={() => ctl && ctl.undo()} disabled={!ctl}>↶</button>
          <button className="btn btn--icon" title="Redo" onClick={() => ctl && ctl.redo()} disabled={!ctl}>↷</button>
          <button className="btn" onClick={() => { if (leaveOk()) startNew(); }} disabled={!ctl || !!busy}>New</button>
          {meta.id && <button className="btn" onClick={() => { if (leaveOk()) openBoard(meta.id); }} disabled={!!busy}>Reload</button>}
          <button className={'btn btn--primary savebtn' + (dirty ? ' is-dirty' : '')} onClick={save} disabled={!ctl || !!busy}>
            {busy === 'saving' ? 'Saving…' : busy === 'loading' ? 'Loading…' : 'Save'}
          </button>
        </div>
        <div className="sheetbar__status">
          <span><i className={'dot' + (!meta.id ? ' dot--new' : dirty ? ' dot--dirty' : '')} />{status}</span>
          {meta.alliance && <AllianceChip a={meta.alliance} />}
        </div>
      </div>

      {draft && (
        <div className="note note--warn" style={{ marginBottom: 'var(--s3)' }}>
          <div className="row">
            <span style={{ flex: 1 }}>A draft of this board from {fmtTime(draft.at)} was left unsaved in this browser.</span>
            <button className="btn btn--sm" onClick={restoreDraft}>Restore draft</button>
            <button className="btn btn--sm btn--quiet" onClick={() => { store.del(draftKey(meta)); setDraft(null); }}>Discard</button>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <div className="note note--bad" style={{ marginBottom: 'var(--s3)' }}>
          <strong>Not saved.</strong> Every row needs a rank, a name in the Name in video column, and points:
          <ul>{problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}{problems.length > 8 && <li>and {problems.length - 8} more</li>}</ul>
        </div>
      )}

      <SheetWorkspace onReady={onReady} />
    </>
  );
}
