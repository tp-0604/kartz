/**
 * One workbook: its tabs along the bottom, the tab you are on above them, and a bar that says
 * what the cell under the cursor really is.
 *
 * Tabs at the bottom because that is where a spreadsheet keeps them, and because a file here
 * can have thirty-six of them — with a box to filter by name, since flicking a strip of
 * thirty-six is not navigation.
 *
 * Which tab you were on is remembered per file, so coming back to a workbook lands where you
 * left it rather than on tab one.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import * as API from '../services/api.js';
import { isAdmin } from '../utils/roles.js';
import { store } from '../utils/storage.js';
import { refOf } from './bands.js';
import Cover from './Cover.jsx';
import SheetGrid from './SheetGrid.jsx';
import { rememberOpened } from './Rail.jsx';

const SheetEditorDialog = lazy(() => import('./SheetEditorDialog.jsx'));

const SHAPE = {
  table: ['pill--ok', 'table'],
  layout: ['pill--view', 'layout'],
  mixed: ['pill--warn', 'mixed'],
  empty: ['pill--flat', 'empty'],
};

const LAST_TABS = 'files.lastTab';
const rememberTab = (fileId, idx) => {
  const map = store.get(LAST_TABS) || {};
  map[fileId] = idx;
  store.set(LAST_TABS, map);
};
const rememberedTab = fileId => ((store.get(LAST_TABS) || {})[fileId]) || 0;

/** What the selected cell is, under the grid: its address, its value, and the formula behind it. */
function CellBar({ at, sheet }) {
  if (!at) {
    return (
      <div className="cellbar cellbar--idle">
        <span className="cellbar__ref">—</span>
        <span className="hint">
          {sheet ? `${(sheet.rows || 0).toLocaleString()} rows · ${(sheet.cols || 0)} columns` : ''}
        </span>
      </div>
    );
  }
  const cell = at.cell;
  const formula = cell && cell[4];
  const google = at.note && String(at.note).startsWith('google:') ? String(at.note).slice(7) : null;
  return (
    <div className="cellbar">
      <span className="cellbar__ref">{refOf(at.r, at.c)}</span>
      <span className="cellbar__value">
        {formula ? <code>={formula}</code>
          : cell && cell[2] !== null && cell[2] !== '' ? String(cell[2])
          : <em>empty</em>}
      </span>
      {google && (
        <span className="cellbar__note" title={google}>
          value only — this was <code>{google.slice(0, 40)}{google.length > 40 ? '…' : ''}</code> in Sheets
        </span>
      )}
      {at.note && !google && <span className="cellbar__note">value only — the formula was not kept</span>}
    </div>
  );
}

export default function FileView({ fileId, sheetIdx, onBack }) {
  const { user, notify } = useApp();
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  const [at, setAt] = useState(0);
  const [meta, setMeta] = useState(null);
  const [cell, setCell] = useState(null);
  const [find, setFind] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let dead = false;
    setBook(null); setError(null); setMeta(null); setCell(null); setFind('');
    API.readFile(fileId)
      .then(out => {
        if (dead) return;
        setBook(out);
        rememberOpened(out.file);
        const wanted = sheetIdx !== undefined && sheetIdx !== null ? sheetIdx : rememberedTab(fileId);
        setAt(Math.min(Math.max(0, wanted), Math.max(0, out.sheets.length - 1)));
      })
      .catch(e => { if (!dead) setError(e.message || String(e)); });
    return () => { dead = true; };
  }, [fileId, sheetIdx]);

  const sheet = book && book.sheets[at];

  useEffect(() => {
    if (!sheet) return undefined;
    let dead = false;
    setMeta(null); setCell(null);
    API.sheetMeta(sheet.id)
      .then(out => { if (!dead) setMeta(out.meta || {}); })
      .catch(() => { if (!dead) setMeta({}); });
    return () => { dead = true; };
  }, [sheet && sheet.id]);

  const pick = useCallback(i => { setAt(i); rememberTab(fileId, i); }, [fileId]);

  const onVersion = useCallback(version => {
    setBook(prev => (prev ? {
      ...prev,
      sheets: prev.sheets.map(s => (s.id === (sheet && sheet.id) ? { ...s, version } : s)),
    } : prev));
  }, [sheet && sheet.id]);

  const shown = useMemo(() => {
    if (!book) return [];
    const q = find.trim().toLowerCase();
    return book.sheets
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !q || s.name.toLowerCase().includes(q));
  }, [book, find]);

  if (error) return <div className="pane"><div className="note note--bad">{error}</div></div>;
  if (!book) return <div className="loading">Opening…</div>;

  const shape = SHAPE[sheet ? sheet.shape : 'empty'] || SHAPE.empty;
  const report = book.file.report;
  const admin = isAdmin(user);
  const readOnly = sheet && sheet.shape === 'layout' && !admin;

  return (
    <div className="fileview">
      <div className="fileview__bar">
        <button type="button" className="btn btn--sm" onClick={onBack}>‹ Back</button>
        <b>{book.file.name}</b>
        <span className="hint">
          {book.sheets.length} tab{book.sheets.length === 1 ? '' : 's'} · {book.file.cells.toLocaleString()} cells
          {book.file.owner ? ' · sent by ' + book.file.owner : ''}
        </span>
        <span className={'pill ' + shape[0]}>{shape[1]}</span>
        {readOnly && <span className="pill pill--flat">read only</span>}
        <div className="fileview__acts">
          {admin && sheet && (
            <button type="button" className="btn btn--sm" onClick={() => setSheetOpen(true)}>
              Edit in spreadsheet
            </button>
          )}
        </div>
      </div>

      {report && report.notes && report.notes.length > 0 && at === 0 && (
        <div className="fileview__report">
          <b>When this was imported:</b> {report.notes.join(' · ')}
        </div>
      )}

      <div className="fileview__body">
        {sheet
          ? <SheetGrid sheet={sheet} styles={book.styles} meta={meta} fileId={fileId}
                       onVersion={onVersion} onCell={setCell} />
          : <div className="empty"><h3>No tabs</h3></div>}
      </div>

      <CellBar at={cell} sheet={sheet} />

      <div className="tabstrip" role="tablist" aria-label="Tabs">
        {book.sheets.length > 8 && (
          <input className="tabstrip__find" value={find} onChange={e => setFind(e.target.value)}
                 placeholder={`Find one of ${book.sheets.length}…`} aria-label="Find a tab" />
        )}
        {shown.map(({ s, i }) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === at}
                  className={'tabstrip__tab' + (s.hidden ? ' is-hidden' : '')}
                  style={s.tabColor ? { '--tab': s.tabColor } : undefined}
                  onClick={() => pick(i)} title={`${s.name} · ${s.cells.toLocaleString()} cells`}>
            <Cover cover={s.cover} className="tabstrip__cover" />
            <span>{s.name}</span>
          </button>
        ))}
        {find && !shown.length && <span className="hint" style={{ padding: '6px 10px' }}>No tab by that name</span>}
      </div>

      {sheetOpen && sheet && (
        <Suspense fallback={null}>
          <SheetEditorDialog file={book.file} sheet={sheet} styles={book.styles} meta={meta || {}}
                             notify={notify}
                             onClose={() => setSheetOpen(false)}
                             onSaved={version => {
                               setSheetOpen(false);
                               onVersion(version);
                               notify('Saved. Reopening the sheet.', 'ok');
                               API.readFile(fileId).then(setBook).catch(() => {});
                             }} />
        </Suspense>
      )}
    </div>
  );
}
