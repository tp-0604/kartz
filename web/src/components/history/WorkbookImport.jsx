// Backloading the whole tracking workbook.
//
// Download the Google Sheet as .xlsx, drop it here, check the dates, press the button. The
// workbook is read in the browser — nothing is uploaded — and nothing is written until the
// button is pressed.
import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { classify, planWorkbook, monthLabel } from '../../services/workbook.js';
import { createBoard } from '../../services/api.js';
import { AllianceChip, Empty } from '../shared/ui.jsx';

const fmtN = n => n.toLocaleString();

export default function WorkbookImport() {
  const { matchRoster, refreshBoards, notify, boards } = useApp();
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [unread, setUnread] = useState([]);
  const [dates, setDates] = useState({});
  const [minRows, setMinRows] = useState(3);
  const [replace, setReplace] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [run, setRun] = useState(null);        // { done, total, ok, skipped, failed, log }
  const [dragOn, setDragOn] = useState(false);
  const input = useRef(null);

  const plan = useMemo(
    () => (sheets ? planWorkbook(sheets, { roster: matchRoster, dates, minRows, existing: boards }) : null),
    [sheets, matchRoster, dates, minRows, boards]);

  const read = async f => {
    if (!f) return;
    setErr(''); setRun(null); setDates({}); setFile(f); setReading(true);
    try {
      const { readXlsx } = await import('../../services/xlsx.js');
      const out = await readXlsx(f, name => classify(name).kind !== 'skip');
      if (!out.sheets.length) throw new Error('No tabs in that file had scores in them.');
      setSheets(out.sheets);
      setUnread(out.skipped.map(name => ({ name, why: classify(name).why || 'not read' })));
    } catch (e) {
      setErr(e.message || String(e));
      setSheets(null);
    } finally { setReading(false); }
  };

  const importAll = async () => {
    if (!plan || !plan.boards.length) return;
    const total = plan.boards.length;
    const state = { done: 0, total, ok: 0, rows: 0, existing: 0, failed: 0, log: [] };
    setRun({ ...state });
    for (const b of plan.boards) {
      try {
        const j = await createBoard({
          date: b.date, alliance: b.alliance, label: b.label || null,
          rows: b.rows.map(r => ({ place: r.place, search: r.search, ingame: r.ingame,
                                   alliance: r.alliance, points: r.points })),
          replace,
        });
        state.ok++; state.rows += j.saved;
      } catch (e) {
        if (e.status === 409) { state.existing++; }
        else { state.failed++; state.log.push(`${b.date} ${b.alliance}: ${e.message}`); }
      }
      state.done++;
      setRun({ ...state, log: state.log.slice(-6) });
    }
    refreshBoards().catch(() => {});
    notify(`Imported ${state.ok} boards, ${fmtN(state.rows)} rows`
      + (state.existing ? ` · ${state.existing} already saved` : '')
      + (state.failed ? ` · ${state.failed} failed` : ''));
  };

  const t = plan && plan.totals;

  return (
    <section>
      <div className="shead"><h2>Import the whole workbook</h2></div>
      <p className="note" style={{ marginTop: 0 }}>
        In Google Sheets: <strong>File → Download → Microsoft Excel (.xlsx)</strong>, then drop the file here.
        Every tab named for a month is read; the roster tab is not, because the app reads that live.
        The file stays in this browser and nothing is saved until you press Import.
      </p>

      <div className={'drop' + (dragOn ? ' on' : '')}
           onClick={() => input.current && input.current.click()}
           onDragOver={e => { e.preventDefault(); setDragOn(true); }}
           onDragLeave={e => { e.preventDefault(); setDragOn(false); }}
           onDrop={e => { e.preventDefault(); setDragOn(false); read(e.dataTransfer.files[0]); }}>
        <strong>{file ? file.name : 'Choose or drop Kartz Tracking.xlsx'}</strong>
        <span>{reading ? 'reading…' : file ? `${(file.size / 1e6).toFixed(1)} MB · tap to change` : 'the workbook, downloaded as Excel'}</span>
      </div>
      <input ref={input} type="file" className="hide" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
             onChange={e => read(e.target.files[0])} />

      {err && <div className="problems" style={{ marginTop: 12 }}>{err}</div>}

      {plan && (
        <>
          <div className="okbox">
            Read {sheets.length} tabs: <strong>{t.boards} boards</strong>, {fmtN(t.rows)} scores, {fmtN(t.players)} players.
            {t.unmatched ? ` ${fmtN(t.unmatched)} names are not on today's roster — they keep the name the sheet used.` : ' Every name matched the roster.'}
          </div>

          <h3 className="subhead" style={{ marginBottom: 4 }}>When each event started</h3>
          <p className="note" style={{ marginTop: 0 }}>
            A month tab records Day 1, Day 4 and the Final but never says which days those were.
            A month is dated from a board you have already saved where there is one, then from the dated
            rows the workbook itself holds. Those all land on the fourth Monday, so a month with neither is
            offered its fourth Monday — worth a glance, because August 2026 ran from the Tuesday.
            Change any that are wrong; Day 4 and the Final follow, three and six days later.
          </p>
          <div className="previewlist">
            {plan.months.map(m => {
              const boards = plan.boards.filter(b => b.month === m.month);
              return (
                <div key={m.month}>
                  <div className="monthrow">
                    <button className="ghost sm disc" onClick={() => setOpen(o => ({ ...o, [m.month]: !o[m.month] }))}
                            aria-expanded={!!open[m.month]}>{open[m.month] ? '▾' : '▸'}</button>
                    <b>{monthLabel(m.month)}</b>
                    <input type="date" value={m.day1}
                           onChange={e => setDates(d => ({ ...d, [m.month]: e.target.value }))} />
                    <span className={'tag ' + (m.from === 'monday' ? 'tag-new' : 'tag-ok')}>
                      {{ you: 'your date', saved: 'from a board you saved', workbook: 'dated by the workbook' }[m.from] || 'fourth Monday'}
                    </span>
                    <span className="st">{m.boards} boards · {fmtN(m.rows)} scores</span>
                  </div>
                  {open[m.month] && (
                    <div className="boardsub">
                      {boards.map(b => (
                        <div key={b.date + b.alliance} className="previewrow">
                          <AllianceChip a={b.alliance} />
                          <span><b>{b.date}</b> · {b.label || 'no day'} · top {Math.max(...b.rows.map(r => r.points)).toLocaleString()}</span>
                          <span className="st">{b.rows.length} rows{b.unmatched ? ` · ${b.unmatched} new` : ''}</span>
                          <span className="st">{b.source}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary>What was left out, and what was joined up</summary>
            <div className="mapping" style={{ marginBottom: 10 }}>
              <span className="role">Smallest board</span>
              <div>
                <input type="number" min="1" max="50" value={minRows} style={{ width: 90 }}
                       onChange={e => setMinRows(Math.max(1, +e.target.value || 1))} />
                <span className="inline-note" style={{ marginLeft: 10 }}>
                  a tab with one stray cell in a column is not a board; set this to 1 to keep everything
                </span>
              </div>
            </div>
            {plan.excluded.length > 0 && (
              <>
                <p className="note" style={{ marginTop: 0 }}><strong>{plan.excluded.length} left out</strong></p>
                <ul className="thinlist">
                  {plan.excluded.map(b => (
                    <li key={b.date + b.alliance + b.label}>{b.date} {b.alliance} {b.label || ''} — {b.rows.length} rows, {b.why} <span className="st">({b.source})</span></li>
                  ))}
                </ul>
              </>
            )}
            {plan.merged.length > 0 && (
              <>
                <p className="note"><strong>{plan.merged.length} boards two tabs both described</strong>, joined into one — every player either tab recorded, and where both hold the same player the dated tab is believed.</p>
                <ul className="thinlist">
                  {plan.merged.map(b => (
                    <li key={b.date + b.alliance}>{b.date} {b.alliance} — {b.mergedFrom.map(m => `${m.source} (${m.rows})`).join(' + ')} → {b.rows.length}</li>
                  ))}
                </ul>
              </>
            )}
            {(unread.length > 0 || plan.unknown.length > 0) && (
              <>
                <p className="note"><strong>Tabs not read</strong></p>
                <ul className="thinlist">
                  {[...unread, ...plan.unknown].map(s => <li key={s.name}>{s.name} — {s.why}</li>)}
                </ul>
              </>
            )}
          </details>

          <div className="mapping" style={{ marginTop: 12 }}>
            <span className="role">Existing</span>
            <label className="colopt" style={{ margin: 0 }}>
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
              <span>Replace boards already saved for the same date and alliance</span>
            </label>
          </div>

          {run ? (
            <div style={{ marginTop: 14 }}>
              <div className="bar"><i style={{ width: (run.done / run.total * 100) + '%' }} /></div>
              <p className="note">
                {run.done} of {run.total} · {run.ok} saved, {fmtN(run.rows)} rows
                {run.existing ? ` · ${run.existing} already saved` : ''}
                {run.failed ? ` · ${run.failed} failed` : ''}
                {run.done === run.total ? ' — done.' : ''}
              </p>
              {run.log.map((l, i) => <p key={i} className="note" style={{ color: 'var(--bad)' }}>{l}</p>)}
            </div>
          ) : (
            <div className="btnrow">
              <button onClick={importAll} disabled={!plan.boards.length}>
                Import {plan.boards.length} boards · {fmtN(t.rows)} scores
              </button>
            </div>
          )}
        </>
      )}

      {!plan && !reading && !err && (
        <div style={{ marginTop: 14 }}>
          <Empty title="Nothing read yet">Drop the workbook above. You will see every board it would create, and the dates, before anything is saved.</Empty>
        </div>
      )}
    </section>
  );
}
