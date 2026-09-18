/**
 * Extraction → data.
 *
 * This is the step that used to be a clipboard, a browser tab and a spreadsheet. The rows are
 * already reviewed; all that is left is the question the old workflow never asked — what is
 * already in the database, and what should happen to it.
 *
 * Nothing is written until one of the buttons is pressed. The counts on them come from the
 * Worker comparing these rows against the board's, not from a guess made here.
 */
import { useEffect, useState } from 'react';
import { commit } from '../services/api.js';
import { AllianceChip } from '../components/shared/ui.jsx';
import { fmtTime } from '../utils/format.js';

export default function CommitDialog({ payload, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let live = true;
    commit({ ...payload, mode: 'preview' })
      .then(p => live && setPreview(p))
      .catch(e => live && setError(e.message || String(e)));
    return () => { live = false; };
  }, [payload]);

  const run = async mode => {
    setBusy(mode); setError('');
    try {
      const out = await commit({ ...payload, mode, version: preview ? preview.version : undefined });
      setResult({ mode, ...out });
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(''); }
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Add to the data">
        <div className="dialog__head">
          <h2>Add to the data</h2>
          <AllianceChip a={payload.alliance} />
          <span className="hint">{payload.date}{payload.label ? ' · ' + payload.label : ''}</span>
          <span className="spacer" />
          <button className="btn btn--sm btn--quiet" onClick={onClose} disabled={!!busy}>Close</button>
        </div>

        <div className="dialog__body">
          {error && <div className="note note--bad">{error}</div>}

          {result ? (
            <>
              <div className="note note--ok">
                <strong>Done.</strong> {result.added ?? result.saved} row
                {(result.added ?? result.saved) === 1 ? '' : 's'} written
                {result.replaced ? `, ${result.replaced} updated` : ''}
                {result.kept ? `, ${result.kept} hand-corrected row${result.kept > 1 ? 's' : ''} kept` : ''}.
                No copying, no spreadsheet.
              </div>
              <p className="hint">The board is at version {result.version}. The run is on the
                Extraction runs view, so these rows can be traced back to the recording that made them.</p>
              <div className="btnrow">
                <button className="btn btn--primary btn--lg" onClick={() => onDone(result.board)}>
                  Open it in Data
                </button>
                <button className="btn" onClick={onClose}>Stay here</button>
              </div>
            </>
          ) : !preview ? (
            <div className="loading">Checking what is already there…</div>
          ) : (
            <>
              <div className="kpis">
                <div className="kpi">
                  <span className="kpi__label">Detected</span>
                  <span className="kpi__value">{preview.total}</span>
                </div>
                <div className="kpi">
                  <span className="kpi__label">New</span>
                  <span className="kpi__value" style={{ color: 'var(--ok)' }}>{preview.new}</span>
                </div>
                <div className="kpi">
                  <span className="kpi__label">Already there</span>
                  <span className="kpi__value" style={{ color: preview.duplicates ? 'var(--warn)' : 'inherit' }}>
                    {preview.duplicates}
                  </span>
                </div>
              </div>

              {!preview.exists ? (
                <p className="hint">
                  There is no {payload.alliance} board for {payload.date} yet, so all {preview.total} rows
                  are new.
                </p>
              ) : (
                <p className="hint">
                  A {payload.alliance} board for {payload.date} already holds {preview.existingRows} rows,
                  last saved {fmtTime(preview.savedAt)}
                  {preview.handEdited ? `, ${preview.handEdited} of them corrected by hand` : ''}.
                  A player counts as already there when the roster name matches, or the drawn name
                  where there is no roster name — the same identity the review table used.
                </p>
              )}

              {preview.samples.length > 0 && (
                <details className="disclosure">
                  <summary>Look at the {preview.duplicates} already there</summary>
                  <div className="tablewrap" style={{ maxHeight: 260 }}>
                    <table className="tbl">
                      <thead><tr>
                        <th>Player</th><th className="num">Rank now</th><th className="num">Rank here</th>
                        <th className="num">Points now</th><th className="num">Points here</th>
                      </tr></thead>
                      <tbody>
                        {preview.samples.map((s, i) => (
                          <tr key={i}>
                            <td className="namecell">{s.name}</td>
                            <td className="num">{s.wasPlace}</td>
                            <td className="num">{s.place}</td>
                            <td className="num">{s.was.toLocaleString()}</td>
                            <td className="num">{s.now.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              <div className="stack stack--tight">
                <button className="btn btn--primary btn--lg btn--block" disabled={!!busy || !preview.new}
                        onClick={() => run('new')}>
                  {busy === 'new' ? 'Adding…' : `Add the ${preview.new} new record${preview.new === 1 ? '' : 's'}`}
                </button>
                {preview.exists && preview.duplicates > 0 && (
                  <button className="btn btn--block" disabled={!!busy} onClick={() => run('all')}>
                    {busy === 'all' ? 'Adding…'
                      : `Add all ${preview.total}, updating the ${preview.duplicates} already there`}
                  </button>
                )}
                {preview.exists && preview.canReplace === false && (
                  <p className="hint">This board was sent by {preview.owner || 'someone before accounts'},
                    so only {preview.owner ? 'they or an admin' : 'an admin'} can replace it. Adding the
                    new records is still yours to do.</p>
                )}
                {preview.exists && preview.canReplace !== false && (
                  <button className="btn btn--block" disabled={!!busy}
                          onClick={() => {
                            if (window.confirm(`Replace the whole ${payload.alliance} board for `
                              + `${payload.date} with these ${preview.total} rows?\n\n`
                              + 'Rows somebody corrected by hand are kept; everything else is replaced.'))
                              run('replace');
                          }}>
                    {busy === 'replace' ? 'Replacing…' : 'Replace the whole board with these rows'}
                  </button>
                )}
                <p className="hint">Adding only the new records leaves everything already saved
                  exactly as it is, which is almost always what a second recording of the same day
                  should do.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
