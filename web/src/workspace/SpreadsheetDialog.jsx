/**
 * "Open in spreadsheet": the dataset in a full spreadsheet engine, for the work the grid does not
 * do — formulas, merges, borders, number formats, a whole sheet reshaped at once.
 *
 * It starts from what is saved. Saving sends what changed in the rows as one batch against the
 * version it was opened at — the same operations a grid edit sends, so every view, the analyst
 * and export see it — and then stores the workbook itself beside the rows, so the formulas and the
 * formatting are there next time. If the rows change anywhere else in between, the next open
 * starts again from the rows instead of showing an older sheet.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import * as API from '../services/api.js';
import { toBlock, diffBlock } from '../sheet/sheetRows.js';
import Boundary from '../components/shared/Boundary.jsx';

const SpreadsheetEditor = lazy(() => import('../sheet/SpreadsheetEditor.jsx'));
const newRowId = () => 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const count = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export default function SpreadsheetDialog({ ds, notify, onSaved, onClose }) {
  const [start, setStart] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const ctl = useRef(null);
  const key = ds.key;

  useEffect(() => {
    let alive = true;
    Promise.all([API.loadDataset(key), API.loadSheet(key)])
      .then(([data, sheet]) => {
        if (!alive) return;
        setStart({
          kind: data.dataset.kind, title: data.dataset.title, version: data.version,
          columns: data.columns, rows: data.rows,
          block: toBlock(data.columns, data.rows),
          widths: data.columns.map(c => c.width),
          workbook: sheet.workbook && sheet.version === data.version ? sheet.workbook : null,
        });
      })
      .catch(e => { if (alive) setError('Could not open it: ' + (e.message || String(e))); });
    return () => { alive = false; };
  }, [key]);

  const onReady = c => { ctl.current = c; setReady(!!c); };

  const close = () => {
    if (busy) return;
    if (ctl.current && ctl.current.isDirty()
        && !window.confirm('Close the spreadsheet without saving? What you changed in it will be lost.')) return;
    onClose();
  };

  const save = async () => {
    if (!ctl.current || !start || busy) return;
    setBusy(true); setError(null);
    let rowsSaved = false;
    try {
      const { ops, inserted, counts } = diffBlock(ctl.current.read(), start.columns, start.rows,
                                                  { kind: start.kind, newId: newRowId });
      if (counts.deleted && !window.confirm(
        `${count(counts.deleted, 'row')} ${counts.deleted === 1 ? 'is' : 'are'} no longer in the spreadsheet, `
        + `so saving deletes ${counts.deleted === 1 ? 'it' : 'them'}. Save anyway?`)) {
        setBusy(false);
        return;
      }

      let version = start.version;
      let rejected = [];
      if (ops.length) {
        const out = await API.applyOps(key, { version, ops });
        version = out.version;
        rejected = out.rejected || [];
        rowsSaved = true;
      }
      // New rows have ids now. Writing them into the hidden column before the workbook is stored
      // is what stops the next save from adding them a second time.
      ctl.current.writeIds(inserted);
      await API.saveSheet(key, { version, workbook: ctl.current.snapshot() });

      const parts = [];
      if (counts.updated) parts.push(count(counts.updated, 'row') + ' changed');
      if (counts.inserted) parts.push(count(counts.inserted, 'row') + ' added');
      if (counts.deleted) parts.push(count(counts.deleted, 'row') + ' deleted');
      if (counts.columns) parts.push(count(counts.columns, 'new column'));
      notify(parts.length ? `Saved — ${parts.join(', ')}.` : 'Spreadsheet saved.');
      if (rejected.length)
        notify(`${count(rejected.length, 'change')} could not be saved: ${rejected[0].reason}`, 'warn', 8000);
      await ds.reload();
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      const why = e.message || String(e);
      setError(e instanceof API.ApiError && e.status === 409 && !rowsSaved
        ? 'This was saved somewhere else while the spreadsheet was open, so nothing here was saved. '
          + 'Close the spreadsheet and open it again to start from the newer version.'
        : rowsSaved
          ? `The rows were saved, but the spreadsheet itself could not be stored (${why}). `
            + 'Close and open it again before making more changes.'
          : 'Could not save: ' + why);
      setBusy(false);
    }
  };

  const hint = error ? ''
    : !start ? 'Loading…'
    : !ready ? 'Opening the spreadsheet — the first time takes a moment'
    : start.workbook ? 'As you last saved it here' : 'Built from the saved rows';

  return (
    <div className="sheetdlg" role="dialog" aria-modal="true" aria-label="Spreadsheet">
      <div className="sheetdlg__bar">
        <span className="sheetdlg__title">{start ? start.title : 'Spreadsheet'}</span>
        <span className="sheetdlg__hint">{hint}</span>
        <span className="spacer" />
        <button className="btn btn--sm btn--primary" onClick={save} disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn--sm" onClick={close} disabled={busy}>Close</button>
      </div>
      {error && <div className="sheetdlg__note"><div className="note note--bad">{error}</div></div>}
      <div className="sheetdlg__body">
        {start && (
          <Boundary fallback={err => (
            <div className="sheetdlg__wait">The spreadsheet could not load: {String((err && err.message) || err)}</div>
          )}>
            <Suspense fallback={<div className="sheetdlg__wait">Loading the spreadsheet…</div>}>
              <SpreadsheetEditor block={start.block} widths={start.widths} workbook={start.workbook}
                                 onReady={onReady} />
            </Suspense>
          </Boundary>
        )}
      </div>
    </div>
  );
}
