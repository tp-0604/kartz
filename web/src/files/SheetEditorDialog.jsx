/**
 * An imported tab in the spreadsheet engine.
 *
 * The quick grid is for correcting a value. This is for the work it does not do — formulas,
 * merging, borders, number formats, reshaping a sheet at once — and it is an admin's, because
 * a sheet reshaped by accident is harder to undo than a cell changed by accident.
 *
 * It opens from the cells as they are stored and saves back the same way: every band the tab
 * occupies, rewritten against the version it was opened at. A save built on a copy somebody
 * else has already written over is refused rather than landing on top of theirs.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import * as API from '../services/api.js';
import Boundary from '../components/shared/Boundary.jsx';
import { BAND, unpackBand } from './bands.js';
import { fromUniver, toUniver } from './univerBridge.js';
import { makeCover } from '../services/bookImport.js';

const SpreadsheetEditor = lazy(() => import('../sheet/SpreadsheetEditor.jsx'));

const toB64 = bytes => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export default function SheetEditorDialog({ file, sheet, styles, meta, onClose, onSaved, notify }) {
  const [workbook, setWorkbook] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const ctl = useRef(null);
  const opened = useRef(sheet.version);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const answer = await API.sheetCells(sheet.id, 0, Math.max(0, (sheet.rows || 1) - 1));
        const cells = [];
        for (const band of answer.bands || []) cells.push(...await unpackBand(band));
        if (!alive) return;
        opened.current = answer.version || sheet.version;
        setWorkbook(toUniver({ sheet, styles, meta: meta || {}, cells }));
      } catch (e) {
        if (alive) setError(e.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, [sheet.id]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const save = async () => {
    if (!ctl.current) return;
    setBusy(true);
    try {
      const snapshot = ctl.current.snapshot();
      const out = fromUniver(snapshot, styles);
      const { gzipSync, strToU8 } = await import('fflate');

      // The style pool may have grown; it is written first, so no cell points at nothing.
      if (out.styles.length !== styles.length) await API.putStyles(file.id, out.styles);

      const bands = new Map();
      for (const cell of out.cells) {
        const band = Math.floor(cell[0] / BAND);
        let list = bands.get(band);
        if (!list) bands.set(band, (list = []));
        list.push(cell);
      }
      // Bands the tab used to have and no longer does are emptied rather than left behind.
      const had = Math.max(1, Math.ceil((sheet.rows || 1) / BAND));
      for (let b = 0; b < had; b++) if (!bands.has(b)) bands.set(b, []);

      let version = opened.current;
      const ordered = [...bands.entries()].sort((a, b) => a[0] - b[0]);
      for (const [band, cells] of ordered) {
        const bytes = gzipSync(strToU8(JSON.stringify(cells)), { level: 6 });
        const answer = await API.putSlab(sheet.id, {
          band, count: cells.length, cells: toB64(bytes), version,
          rows: out.rows, cols: out.cols,
          ...(band === 0 ? { cover: makeCover(out.cells, out.styles) } : {}),
          ...(band === 0 ? { summary: `edited ${sheet.name} in the spreadsheet` } : {}),
        });
        version = answer.version;
      }

      if (out.merges.length || (meta && meta.merges)) {
        await API.putSheetMeta(sheet.id, 'merges', out.merges);
      }
      onSaved(version);
    } catch (e) {
      if (e.status === 409) {
        notify('Somebody else changed this sheet while it was open here. Close and open it again.', 'bad');
      } else {
        notify(e.message || String(e), 'bad');
      }
      setBusy(false);
    }
  };

  return (
    <div className="scrim">
      <div className="sheetdlg" role="dialog" aria-modal="true" aria-label="Spreadsheet">
        <div className="sheetdlg__bar">
          <b>{file.name}</b>
          <span className="hint">{sheet.name} · {(sheet.cells || 0).toLocaleString()} cells</span>
          <span className="pill pill--flat">admin</span>
          <div className="sheetdlg__acts">
            <button type="button" className="btn btn--sm" onClick={onClose} disabled={busy}>Close</button>
            <button type="button" className="btn btn--sm btn--primary" onClick={save} disabled={busy || !ready}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="sheetdlg__body">
          {error ? <div className="note note--bad">{error}</div>
            : !workbook ? <div className="loading">Reading the sheet…</div>
            : (
              <Boundary label="the spreadsheet">
                <Suspense fallback={<div className="loading">Loading the spreadsheet engine…</div>}>
                  <SpreadsheetEditor workbook={workbook} block={null} widths={[]}
                                     onReady={api => { ctl.current = api; setReady(true); }} />
                </Suspense>
              </Boundary>
            )}
        </div>
      </div>
    </div>
  );
}
