/**
 * One workbook: its tabs along the bottom, the tab you are on above them.
 *
 * Tabs at the bottom because that is where a spreadsheet keeps them and because a file here can
 * have thirty-six of them — a strip you can flick through without leaving the sheet is worth
 * more than a tidy sidebar.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import * as API from '../services/api.js';
import { isAdmin } from '../utils/roles.js';
import Cover from './Cover.jsx';
import SheetGrid from './SheetGrid.jsx';

const SHAPE = {
  table: ['pill--ok', 'table'],
  layout: ['pill--view', 'layout'],
  mixed: ['pill--warn', 'mixed'],
  empty: ['pill--flat', 'empty'],
};

export default function FileView({ fileId, sheetIdx = 0, onBack }) {
  const { user, notify, openSection } = useApp();
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);
  const [at, setAt] = useState(sheetIdx);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    let dead = false;
    setBook(null); setError(null); setAt(sheetIdx); setMeta(null);
    API.readFile(fileId)
      .then(out => { if (!dead) setBook(out); })
      .catch(e => { if (!dead) setError(e.message || String(e)); });
    return () => { dead = true; };
  }, [fileId, sheetIdx]);

  const sheet = book && book.sheets[at];

  useEffect(() => {
    if (!sheet) return undefined;
    let dead = false;
    setMeta(null);
    API.sheetMeta(sheet.id)
      .then(out => { if (!dead) setMeta(out.meta || {}); })
      .catch(() => { if (!dead) setMeta({}); });
    return () => { dead = true; };
  }, [sheet && sheet.id]);

  if (error) return <div className="pane"><div className="note note--bad">{error}</div></div>;
  if (!book) return <div className="loading">Opening…</div>;

  const shape = SHAPE[sheet ? sheet.shape : 'empty'] || SHAPE.empty;
  const report = book.file.report;

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
        <div className="fileview__acts">
          {isAdmin(user) && (
            <button type="button" className="btn btn--sm" onClick={() => notify('The spreadsheet editor is the next piece.', 'ok')}>
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
        {sheet ? <SheetGrid sheet={sheet} styles={book.styles} meta={meta} /> : <div className="empty">No tabs</div>}
      </div>

      <div className="tabstrip" role="tablist" aria-label="Tabs">
        {book.sheets.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === at}
                  className={'tabstrip__tab' + (s.hidden ? ' is-hidden' : '')}
                  style={s.tabColor ? { '--tab': s.tabColor } : undefined}
                  onClick={() => setAt(i)} title={`${s.name} · ${s.cells.toLocaleString()} cells`}>
            <Cover cover={s.cover} className="tabstrip__cover" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
