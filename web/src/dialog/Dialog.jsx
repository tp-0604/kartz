/**
 * The dialog: a recording in, rows in the sheet out.
 *
 * It floats over the spreadsheet and does not block it — a modeless dialog, so the sheet
 * underneath stays live. That changes two things about the design. There is room, so the
 * review is a real table with the columns the sheet has rather than a stack of cards. And the
 * cursor is meaningful: you can click a cell while this is open, so rows can go where you are
 * standing as well as at the end.
 *
 * The flow is four steps and two presses: pick a recording, watch it read, look at what it
 * found, send it. Every step can be backed out of, and the last one can be undone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Sheet from './bridge.js';
import * as API from '../services/api.js';
import { runExtraction } from '../extractor/run.js';
import { guessFields, keyColumns, toKeyed, toSheetRow, unmapped } from './fields.js';
import ReviewTable from './ReviewTable.jsx';
import Settings from './Settings.jsx';
import AskPanel from './AskPanel.jsx';
import { store } from '../utils/storage.js';

const today = () => new Date().toISOString().slice(0, 10);

// What the dialog asks Google to make it. The review earns the extra room; nothing else does.
const SIZE = { base: [760, 548], review: [900, 648] };

const STEPS = ['start', 'reading', 'review', 'done'];

// Outside Sheets only: ?demo=review fills the review with the stand-in's rows, so the table can
// be built and looked at without a recording and a model key. Inside Sheets this never runs.
const DEMO_ROWS = [
  { place: 1, search: 'Nubi', ingame: 'ŊŲƁĮ', alliance: '698W', points: 652 },
  { place: 2, search: 'Goose', ingame: 'GOOSE', alliance: '698W', points: 540 },
  { place: 3, search: 'Glitter', ingame: 'Glitter', alliance: '698W', points: 498 },
  { place: 4, search: '', ingame: 'ᵇᵃᶻ', alliance: '698S', points: 476 },
  { place: 5, search: 'Neaira', ingame: 'Neaira', alliance: '698W', points: 452 },
  { place: 6, search: 'Cutsnake', ingame: 'Cutsnake', alliance: '698W', points: 430 },
  { place: 7, search: 'Eskimo', ingame: 'Eskimo❄️', alliance: '698N', points: 418 },
  { place: 8, search: '', ingame: 'ЯРСаня', alliance: '698W', points: 399 },
  { place: 9, search: 'BigMark', ingame: 'BigMark', alliance: '698W', points: 366 },
  { place: 10, search: 'Amcia', ingame: 'Amcia', alliance: '698C', points: 340 },
  { place: 11, search: 'Cein', ingame: 'Cein🌟', alliance: '698N', points: 312 },
  { place: 12, search: 'Aaron028', ingame: 'Aaron028', alliance: '698W', points: 287 },
];

export default function Dialog() {
  const [step, setStep] = useState('start');        // start | reading | review | done
  const [sheet, setSheet] = useState(null);
  const [roster, setRoster] = useState(null);
  const [worker, setWorker] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [rows, setRows] = useState([]);
  const [dupes, setDupes] = useState([]);
  const [dropped, setDropped] = useState(() => new Set());
  const [meta, setMeta] = useState({ date: today(), label: '' });
  const [where, setWhere] = useState('end');        // end | cursor
  const [cursor, setCursor] = useState(null);
  const [log, setLog] = useState('');
  const [progress, setProgress] = useState(0);
  const [frames, setFrames] = useState([]);
  const [error, setError] = useState(null);
  const [written, setWritten] = useState(null);
  const [panel, setPanel] = useState(null);         // settings | ask
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  /* --------------------------------------------------------------- what is on the sheet */
  const load = useCallback(async () => {
    setError(null);
    try {
      const [here, list, w] = await Promise.all([
        Sheet.readCurrentSheet(), Sheet.readRoster(), Sheet.getWorker(),
      ]);
      setSheet(here);
      setRoster(list);
      setWorker(w);
      API.useWorker({ url: w.url, pass: w.pass });
      setMapping(guessFields(here.headers));
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The window is ours to size, and the review is the only step that needs the extra room.
  useEffect(() => {
    const [w, h] = step === 'review' ? SIZE.review : SIZE.base;
    Sheet.resize(w, h);
  }, [step]);

  // The sheet is live underneath, so where the cursor is can change while this is open. Only
  // while reviewing, because that is the only moment the answer matters.
  useEffect(() => {
    if (step !== 'review') return undefined;
    let alive = true;
    const look = () => Sheet.readSelection().then(s => { if (alive) setCursor(s); }).catch(() => {});
    look();
    const t = setInterval(look, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [step]);

  useEffect(() => {
    if (Sheet.inSheets()) return;
    if (!/[?&]demo=/.test(location.search)) return;
    const which = /[?&]demo=([a-z]+)/.exec(location.search)[1];
    if (which === 'review') { setRows(DEMO_ROWS); setDupes([2, 9]); setStep('review'); }
    if (which === 'reading') {
      setStep('reading'); setProgress(0.42); setLog('reading frame 14 of 31 — board 2 of 3');
    }
    if (which === 'done') { setWritten({ written: 11, from: 41, to: 51, sheet: 'September 2026' }); setStep('done'); }
    if (which === 'ask' || which === 'settings') setPanel(which);
  }, []);

  const missing = useMemo(() => unmapped(mapping), [mapping]);
  const keep = useMemo(() => rows.filter((_, i) => !dropped.has(i)), [rows, dropped]);

  /* ------------------------------------------------------------------------ the reading */
  const read = async file => {
    if (!file) return;
    if (!roster || !roster.ok) { setError('No roster yet — pick the tab it is on in Settings.'); return; }
    if (!API.hasWorker()) { setPanel('settings'); return; }
    setStep('reading'); setError(null); setProgress(0); setFrames([]); setLog('opening the recording…');
    try {
      const out = await runExtraction({
        file,
        roster: roster.rows,
        aliases: store.get('aliases') || {},
        onLog: setLog,
        onProgress: setProgress,
        onFrames: setFrames,
      });
      const found = out.rows || [];
      setRows(found);
      setDropped(new Set());
      // Ask the sheet which of these it already has, before anybody presses send.
      try {
        const keys = keyColumns(mapping, meta);
        const answer = await Sheet.findDuplicates(found.map(r => toKeyed(r, mapping, meta)), keys);
        setDupes((answer.duplicates || []).map(d => d.index));
      } catch { setDupes([]); }
      setStep('review');
    } catch (e) {
      setError(e.message || String(e));
      setStep('start');
    }
  };

  const pick = e => read(e.target.files && e.target.files[0]);

  const drop = e => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) read(file);
  };

  /* -------------------------------------------------------------------------- the write */
  const send = async () => {
    setError(null);
    try {
      const values = keep.map(r => toSheetRow(r, mapping, meta));
      const at = where === 'cursor' && cursor && cursor.row ? cursor.row : 'end';
      const out = await Sheet.insertRows(values, at);
      setWritten(out);
      setStep('done');
      const what = `${out.written} row${out.written === 1 ? '' : 's'} from a recording`
        + (meta.label ? ` — ${meta.label}` : '') + (meta.date ? ` (${meta.date})` : '');
      Sheet.appendLog(what).catch(() => {});
      Sheet.readCurrentSheet().then(setSheet).catch(() => {});
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const undo = async () => {
    if (!written) return;
    try {
      await Sheet.removeRows(written.from, written.written);
      Sheet.appendLog(`undid ${written.written} rows`).catch(() => {});
      setWritten(null);
      setStep('review');
      Sheet.readCurrentSheet().then(setSheet).catch(() => {});
    } catch (e) { setError(e.message || String(e)); }
  };

  const startAgain = () => {
    setStep('start'); setRows([]); setDupes([]); setDropped(new Set());
    setWritten(null); setFrames([]); setProgress(0); setError(null);
  };

  /* ------------------------------------------------------------------------ the chrome */
  const title = sheet ? sheet.spreadsheet : 'Kartz';
  const at = sheet
    ? `${sheet.sheet} · ${sheet.rows.toLocaleString()} rows · ${sheet.headers.length} columns`
    : 'looking at this tab…';
  const here = STEPS.indexOf(step);

  const top = (
    <header className="dlg__top">
      <span className="dlg__mark" aria-hidden="true" />
      <div className="dlg__where"><b>{title}</b><span>{at}</span></div>
      <div className="dlg__steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <i key={s} className={i === here ? 'on' : i < here ? 'done' : ''} />
        ))}
      </div>
      <button type="button" className="ico" title="Ask about this tab"
              onClick={() => setPanel('ask')}>✦</button>
      <button type="button" className="ico" title="Settings"
              onClick={() => setPanel('settings')}>⚙</button>
    </header>
  );

  if (panel === 'settings') {
    return <Settings sheet={sheet} roster={roster} worker={worker} top={top}
                     onClose={() => { setPanel(null); load(); }} />;
  }
  if (panel === 'ask') {
    return <AskPanel sheet={sheet} top={top} onClose={() => setPanel(null)} />;
  }

  const warnings = (
    <>
      {!Sheet.inSheets() && (
        <p className="note note--warn">
          Not running inside Sheets — this is the stand-in spreadsheet, for building the page.
        </p>
      )}
      {sheet && !sheet.canEdit && (
        <p className="note note--warn">You can view this spreadsheet but not change it.</p>
      )}
      {error && <p className="note note--bad">{error}</p>}
    </>
  );

  return (
    <div className="dlg">
      {top}

      {step === 'review' ? (
        <ReviewTable
          rows={rows} dupes={dupes} dropped={dropped} meta={meta} onMeta={setMeta}
          where={where} onWhere={setWhere} cursor={cursor}
          onToggle={i => {
            const next = new Set(dropped);
            if (next.has(i)) next.delete(i); else next.add(i);
            setDropped(next);
          }}
          onDropped={setDropped}
          onSend={send} onCancel={startAgain} warnings={warnings}
          canEdit={!sheet || sheet.canEdit} sheetName={sheet && sheet.sheet}
        />
      ) : (
        <>
          <div className="dlg__body">
            <aside className="dlg__rail">
              {step === 'reading' ? (
                <>
                  <p className="dlg__h">Reading</p>
                  <span className="pct">{Math.round(progress * 100)}%</span>
                  <div className="bar"><i style={{ width: Math.round(progress * 100) + '%' }} /></div>
                  <p className="log">{log}</p>
                  <p className="hint">
                    The recording is read in this window and never uploaded. Only still frames go
                    to the model.
                  </p>
                </>
              ) : (
                <>
                  <p className="dlg__h">This spreadsheet</p>
                  <dl className="facts">
                    <div className="fact">
                      <dt>Roster</dt>
                      <dd>{roster && roster.ok
                        ? <>{roster.count} players<small>on “{roster.tab}”</small></>
                        : <span className="bad">{(roster && roster.reason) || 'not found'}</span>}</dd>
                    </div>
                    <div className="fact">
                      <dt>Rows go to</dt>
                      <dd>{sheet ? <>{sheet.sheet}<small>after row {sheet.lastRow}</small></> : '—'}</dd>
                    </div>
                    <div className="fact">
                      <dt>Model</dt>
                      <dd>{API.hasWorker()
                        ? <>ready<small>{worker && worker.hasPass ? 'phrase set' : 'no phrase set'}</small></>
                        : <span className="bad">no Worker set</span>}</dd>
                    </div>
                  </dl>
                  {missing.length > 0 && sheet && (
                    <p className="note note--warn">
                      Nothing on this tab looks like: {missing.join(', ')}. Check the columns in
                      Settings.
                    </p>
                  )}
                  {warnings}
                </>
              )}
            </aside>

            <section className={'dlg__stage'
                                 + (step !== 'reading' || !frames.length ? ' dlg__stage--mid' : '')}>
              {step === 'start' && (
                <>
                  <button type="button"
                          className={'drop' + (over ? ' is-over' : '')}
                          onClick={() => fileRef.current && fileRef.current.click()}
                          onDragOver={e => { e.preventDefault(); setOver(true); }}
                          onDragLeave={() => setOver(false)}
                          onDrop={drop}>
                    <span className="drop__arrow" aria-hidden="true">↑</span>
                    <b>Drop a recording here</b>
                    <small>or click to pick one. It is read in this window; only the frames leave.</small>
                  </button>
                  <input ref={fileRef} type="file" accept="video/*" hidden onChange={pick} />
                  <p className="hint">
                    The sheet stays live while this is open — click a cell and the rows can go
                    there instead of at the end.
                  </p>
                </>
              )}

              {step === 'reading' && (
                <>
                  {frames.length > 0 ? (
                    <div className="strip">
                      {frames.slice(0, 12).map((f, i) => (
                        <img key={i} src={'data:image/jpeg;base64,' + f} alt="" />
                      ))}
                    </div>
                  ) : (
                    <div className="strip--wait hint">opening the recording…</div>
                  )}
                </>
              )}

              {step === 'done' && written && (
                <div className="done">
                  <span className="tick" aria-hidden="true">✓</span>
                  <b>{written.written} rows added</b>
                  <small>rows {written.from}–{written.to} of “{written.sheet}”</small>
                </div>
              )}
            </section>
          </div>

          <footer className="dlg__foot">
            {step === 'start' && (
              <>
                <span className="grow">
                  {roster && roster.ok && API.hasWorker()
                    ? 'Ready.'
                    : 'Set the roster tab and the Worker in Settings first.'}
                </span>
                <button type="button" className="btn" onClick={() => setPanel('ask')}>Ask about this tab</button>
              </>
            )}
            {step === 'reading' && (
              <>
                <span className="grow">{log}</span>
                <button type="button" className="btn" onClick={startAgain}>Stop</button>
              </>
            )}
            {step === 'done' && (
              <>
                <span className="grow">Written into “{written && written.sheet}”. Nothing else was touched.</span>
                <button type="button" className="btn" onClick={undo}>Undo</button>
                <button type="button" className="btn btn--go" onClick={startAgain}>Do another</button>
              </>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
