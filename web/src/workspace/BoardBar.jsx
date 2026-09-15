/**
 * Which dataset this is, and — for a board — what it is called.
 *
 * A board's identity is its date and the alliance filmed, so changing either renames it. That is
 * a real operation on the database rather than a label, which is why it sits behind a click and
 * says what it is going to do.
 */
import { useEffect, useState } from 'react';
import Dropdown from '../components/shared/Dropdown.jsx';
import { AllianceChip } from '../components/shared/ui.jsx';
import { DAYS, MAIN_ALLIANCES } from '../extractor/config.js';
import { patchBoard } from '../services/api.js';
import { useApp } from '../state/AppContext.jsx';

export default function BoardBar({ dataset, rows, onChanged, onRenamed, boards }) {
  const { notify } = useApp();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(dataset && dataset.kind === 'board'
      ? { date: dataset.date, alliance: dataset.alliance, label: dataset.label || '' } : null);
  }, [dataset]);

  if (!dataset) return <div className="ws__title"><h1 className="muted">Nothing open</h1></div>;

  if (dataset.kind !== 'board')
    return (
      <div className="ws__title">
        <h1>{dataset.title}</h1>
        <span className="hint">{rows.toLocaleString()} players · the identity every score points at</span>
      </div>
    );

  const alliances = [...new Set([...MAIN_ALLIANCES, ...(boards || []).map(b => b.alliance), dataset.alliance])];
  const changed = form && (form.date !== dataset.date || form.alliance !== dataset.alliance
                           || (form.label || '') !== (dataset.label || ''));

  const apply = async close => {
    if (!changed) { close(); return; }
    setBusy(true);
    try {
      const out = await patchBoard(dataset.id, { date: form.date, alliance: form.alliance,
                                                 label: form.label || null });
      notify(out.renamed ? 'Board renamed ✓' : 'Board updated ✓');
      close();
      if (out.renamed && onRenamed) onRenamed('board:' + out.board);
      if (onChanged) await onChanged();
    } catch (e) { notify('Could not change it: ' + e.message, 'bad', 6000); }
    finally { setBusy(false); }
  };

  return (
    <div className="ws__title">
      <AllianceChip a={dataset.alliance} />
      <h1>{dataset.date}</h1>
      <Dropdown label={(dataset.label || 'no day') + ' ▾'} className="btn btn--sm btn--quiet" width={280}
                title="Change the date, the alliance or the scoring day">
        {close => (
          <div style={{ padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="field">
              <span className="label">Filmed on</span>
              <input type="date" className="input--sm" value={form.date}
                     onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="field">
              <span className="label">Alliance</span>
              <select className="input--sm" value={form.alliance}
                      onChange={e => setForm(f => ({ ...f, alliance: e.target.value }))}>
                {alliances.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="label">Scoring day</span>
              <select className="input--sm" value={form.label}
                      onChange={e => setForm(f => ({ ...f, label: e.target.value }))}>
                <option value="">—</option>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <p className="hint">The date and the alliance are the board's name, so changing either
              renames it. The rows go with it.</p>
            <div className="btnrow">
              <button className="btn btn--sm btn--primary" disabled={!changed || busy}
                      onClick={() => apply(close)}>{busy ? 'Saving…' : 'Apply'}</button>
              <button className="btn btn--sm btn--quiet" onClick={close}>Cancel</button>
            </div>
          </div>
        )}
      </Dropdown>
    </div>
  );
}
