// The roster, edited as a spreadsheet.
//
// This is the list now. It used to live in a Google Sheet that the app pulled from, with the
// database holding only the differences; the sheet is out of the loop and these rows are the
// record. Add a player by typing a row, remove one by deleting the row, paste a hundred in
// from anywhere — it is a spreadsheet, and Save writes the whole of it at once.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import SheetWorkspace from '../sheet/SheetWorkspace.jsx';
import { sheetColumns, toSheetValues, fromSheetValues, validate } from '../../sheet/roster.js';
import { store } from '../../utils/storage.js';
import { fmtTime } from '../../utils/format.js';
import { ApiError } from '../../services/api.js';
import { Stats } from '../shared/ui.jsx';

const DRAFT = 'draft.roster';

export default function RosterScreen({ active }) {
  const { roster, rosterMeta, rosterLoaded, loadRoster, saveRoster, notify } = useApp();
  const [ctl, setCtl] = useState(null);
  const ctlRef = useRef(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [problems, setProblems] = useState([]);
  const [draft, setDraft] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const draftTimer = useRef(null);

  const onReady = useCallback(c => { ctlRef.current = c; setCtl(c); }, []);

  useEffect(() => {
    if (!ctl) return;
    setDirty(ctl.isDirty());
    return ctl.onDirty(setDirty);
  }, [ctl]);

  // Draw the roster into the sheet once both the sheet and the rows are ready.
  const draw = useCallback((rows, meta) => {
    const c = ctlRef.current; if (!c) return;
    if (meta && meta.sheet) c.restore(meta.sheet);
    else {
      const cols = sheetColumns(meta ? meta.columns : [], meta ? meta.labels : []);
      c.loadValues(toSheetValues(rows, cols), cols);
    }
    setProblems([]);
    const d = store.get(DRAFT);
    setDraft(d && meta && d.at > (meta.savedAt || '') ? d : null);
  }, []);

  useEffect(() => {
    if (!ctl || !rosterLoaded || seeded) return;
    draw(roster, rosterMeta);
    setSeeded(true);
  }, [ctl, rosterLoaded, roster, rosterMeta, seeded, draw]);

  // A local draft two seconds after the last change, so a closed tab costs nothing.
  useEffect(() => {
    if (!ctl) return;
    clearTimeout(draftTimer.current);
    if (!dirty) return;
    draftTimer.current = setTimeout(() => {
      try { store.set(DRAFT, { at: new Date().toISOString(), snapshot: ctl.snapshot() }); }
      catch { /* a snapshot that cannot be stored is not worth failing over */ }
    }, 2000);
    return () => clearTimeout(draftTimer.current);
  }, [dirty, ctl]);

  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const reload = async () => {
    if (dirty && !window.confirm('This roster has unsaved changes. Throw them away and reload?')) return;
    setBusy('loading');
    try { const j = await loadRoster(); setSeeded(true); draw(j.rows, j.meta); }
    catch (e) { notify('Could not load the roster: ' + e.message, 'bad'); }
    finally { setBusy(''); }
  };

  const save = async () => {
    const c = ctlRef.current; if (!c) return;
    const { rows, columns, labels, blanks } = fromSheetValues(c.readValues());
    const probs = validate(rows);
    if (probs.length) { setProblems(probs); notify('Two rows share a player name. Fix them and save again.', 'warn'); return; }
    if (!rows.length && !window.confirm('That would delete every player. Save an empty roster?')) return;
    if (blanks && !window.confirm(
      `${blanks} row${blanks > 1 ? 's have' : ' has'} something in it but no player name, so ${blanks > 1 ? 'they' : 'it'} will not be saved. Continue?`)) return;
    setProblems([]);
    setBusy('saving');
    try {
      const out = await saveRoster({ rows, columns, labels, sheet: c.snapshot(),
                                     version: rosterMeta.version, allowEmpty: !rows.length });
      store.del(DRAFT); setDraft(null);
      c.markClean();
      notify(`Saved ${out.saved} players ✓`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        notify(e.message + ' — press Reload.', 'bad', 7000);
      else notify('Could not save: ' + e.message, 'bad', 6000);
    } finally { setBusy(''); }
  };

  const restoreDraft = () => {
    const c = ctlRef.current; if (!c || !draft) return;
    c.restore(draft.snapshot); c.markDirty(); setDraft(null);
    notify('Draft restored — press Save to keep it.');
  };

  const alliances = new Set(roster.map(r => r.alliance).filter(Boolean));
  const status = !rosterLoaded ? 'loading…'
    : dirty ? `unsaved changes · last saved ${rosterMeta.savedAt ? fmtTime(rosterMeta.savedAt) : 'never'}`
    : rosterMeta.savedAt ? `saved ${fmtTime(rosterMeta.savedAt)} · version ${rosterMeta.version}`
    : 'not saved yet';

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>Roster</h1>
          <p>Who is who, kept here. The searchable name is a player's identity and is what every score
            points at; the name in video is what the game draws. Anything you add to the right of Alliance
            is yours, and it is kept.</p>
        </div>
        <div className="pagehead__actions">
          <button className="btn btn--icon" title="Undo" onClick={() => ctl && ctl.undo()} disabled={!ctl}>↶</button>
          <button className="btn btn--icon" title="Redo" onClick={() => ctl && ctl.redo()} disabled={!ctl}>↷</button>
          <button className="btn" onClick={reload} disabled={!ctl || !!busy}>Reload</button>
          <button className={'btn btn--primary savebtn' + (dirty ? ' is-dirty' : '')}
                  onClick={save} disabled={!ctl || !!busy}>
            {busy === 'saving' ? 'Saving…' : busy === 'loading' ? 'Loading…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="stack">
        <Stats items={[
          [rosterLoaded ? roster.length : '—', 'players'],
          [alliances.size || '—', 'alliances'],
          [rosterMeta.columns.length + 3, 'columns'],
          [rosterMeta.version || '—', 'version'],
        ]} />

        <div className="rosterstatus">
          <span><i className={'dot' + (dirty ? ' dot--dirty' : rosterMeta.savedAt ? '' : ' dot--new')} />{status}</span>
          <span className="hint">Deleting a row deletes the player. Save writes the whole list at once.</span>
        </div>

        {draft && (
          <div className="note note--warn">
            <div className="row">
              <span style={{ flex: 1 }}>A draft from {fmtTime(draft.at)} was left unsaved in this browser.</span>
              <button className="btn btn--sm" onClick={restoreDraft}>Restore draft</button>
              <button className="btn btn--sm btn--quiet" onClick={() => { store.del(DRAFT); setDraft(null); }}>Discard</button>
            </div>
          </div>
        )}
        {problems.length > 0 && (
          <div className="note note--bad">
            <strong>Not saved.</strong> A player name has to be unique — it is the identity every score points at:
            <ul>{problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}{problems.length > 8 && <li>and {problems.length - 8} more</li>}</ul>
          </div>
        )}

        <SheetWorkspace onReady={onReady} unitId="kartz-roster" name="Roster" className="sheet-host sheet-host--roster" />
      </div>
      {!active && null}
    </>
  );
}
