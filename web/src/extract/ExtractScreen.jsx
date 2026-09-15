/**
 * EXTRACT — screen recording in, rows out.
 *
 * The pipeline underneath is untouched: the same frame sampling, the same prompt, the same
 * roster matching, the same one-character rule, the same review behaviour. What changed is where
 * the rows go afterwards. There is no clipboard step and no spreadsheet in the middle — the
 * reviewed rows go into the database, and the Data workspace is already showing them.
 *
 * It is still done one-handed on a phone in front of the game, so the sequence is numbered and
 * the controls stay large.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { runExtraction } from '../extractor/run.js';
import { aliasKey } from '../extractor/matching.js';
import { DAYS, MAIN_ALLIANCES } from '../extractor/config.js';
import { commit } from '../services/api.js';
import { extractedToRecord } from '../data/records.js';
import ReviewTable, { keptRows, makeOutName } from './ReviewTable.jsx';
import CommitDialog from './CommitDialog.jsx';
import { Empty, FlashButton } from '../components/shared/ui.jsx';

export default function ExtractScreen() {
  const { roster, matchRoster, aliases, setAliases, date, setDate, notify,
          refreshDatasets, openInData } = useApp();
  const [queue, setQueue] = useState([]);              // [{ file, alliance, status, rows }]
  const [label, setLabel] = useState(DAYS[0]);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState(0);
  const [log, setLog] = useState('');
  const [strip, setStrip] = useState([]);
  const [rows, setRows] = useState(null);
  const [allianceAll, setAllianceAll] = useState('');
  const [dragOn, setDragOn] = useState(false);
  const [stats, setStats] = useState(null);
  const [committing, setCommitting] = useState(null);
  const fileInput = useRef(null);
  const outName = makeOutName(roster);

  const pickFiles = list => {
    const files = [...(list || [])].filter(f => f && f.size);
    if (!files.length) return;
    setQueue(files.map(f => ({ file: f, alliance: '', status: 'waiting', rows: 0 })));
    setRows(null); setStrip([]); setLog(''); setProg(0); setStats(null);
  };
  const single = queue.length === 1 ? queue[0].file : null;
  const canRun = matchRoster.length > 0 && queue.length > 0 && !running;

  const runOne = async file => runExtraction({
    file, roster: matchRoster, aliases,
    onLog: setLog, onProgress: setProg, onFrames: setStrip,
  });

  const payloadFor = (rs, alliance, file, out) => ({
    date, alliance, label: label || null,
    rows: keptRows(rs).map(r => extractedToRecord(r, outName)),
    video: file ? file.name : null,
    frames: out ? out.frames : null,
    readings: out ? out.readings : null,
  });

  const extract = async () => {
    setRunning(true); setRows(null); setStats(null);
    try {
      if (queue.length > 1) {
        // The queue: four recordings is what a month actually is. Each board is committed before
        // the next is decoded, so a failure halfway leaves the earlier ones in the database.
        const missing = queue.filter(q => !q.alliance).length;
        if (missing) { setLog(`choose an alliance for ${missing} more recording${missing > 1 ? 's' : ''} first`); return; }
        const setQ = (i, patch) => setQueue(qs => qs.map((q, k) => (k === i ? { ...q, ...patch } : q)));
        let ok = 0;
        for (let i = 0; i < queue.length; i++) {
          const q = queue[i];
          if (q.status === 'saved') { ok++; continue; }
          setQ(i, { status: 'reading…' });
          try {
            const out = await runOne(q.file);
            const rs = out.rows.map(r => ({ ...r, alliancePick: q.alliance }));
            setQ(i, { status: 'saving…' });
            const j = await commit({ ...payloadFor(rs, q.alliance, q.file, out), mode: 'replace' });
            setQ(i, { status: 'saved', rows: j.added ?? j.saved });
            ok++;
          } catch (e) {
            setQ(i, { status: 'failed' });
            setLog(`✗ ${q.file.name}: ${e.message}`);
          }
        }
        setLog(`queue finished — ${ok} of ${queue.length} boards in the database`);
        refreshDatasets();
        return;
      }
      const out = await runOne(single);
      let rs = out.rows;
      const alli = allianceAll || out.suggestedAlliance;
      if (alli) rs = rs.map(r => ({ ...r, alliancePick: alli }));
      setAllianceAll(alli);
      setRows(rs);
      setStats({ frames: out.frames, readings: out.readings });
      setLog(`done — ${out.readings} readings → ${rs.length} players`
        + (alli ? ` · alliance set to ${alli}, change it above the table if wrong` : ''));
    } catch (e) {
      const m = e.message || String(e);
      setLog(/\b429\b/.test(m) && /quota|per day/i.test(m)
        ? '✗ Daily free-tier quota used up. Wait for the reset, or enable billing on the key.'
        : '✗ ' + m);
    } finally { setRunning(false); }
  };

  const addToData = () => {
    if (!allianceAll) { notify('Choose the alliance this board belongs to first.', 'warn'); return; }
    const payload = payloadFor(rows, allianceAll, single, stats);
    if (!payload.rows.length) { notify('Every row is excluded — there is nothing to add.', 'warn'); return; }
    setCommitting(payload);
  };

  const copyRows = async () => {
    const out = keptRows(rows).map(r => [date, r.rank, outName(r), r.points].join('\t')).join('\n');
    try { await navigator.clipboard.writeText(out); return `Copied ${keptRows(rows).length} ✓`; }
    catch { window.prompt('Copy these rows:', out); return 'Copied'; }
  };

  const remember = () => {
    const a = { ...aliases };
    let n = 0;
    for (const r of rows) {
      if (r.match || !r.pick || r.dropped) continue;
      a[aliasKey(r.plain || r.name)] = { name: r.pick, alliance: r.alliancePick || '' };
      n++;
    }
    setAliases(a);
    setLog(n ? `remembered ${n} name${n > 1 ? 's' : ''} — they will match automatically next time`
             : 'nothing new to remember');
    return n ? `Remembered ${n} ✓` : 'Nothing new';
  };

  useEffect(() => { if (!queue.length) setRows(null); }, [queue.length]);

  // ?demo on localhost loads a few made-up rows into the review table, so the path from here to
  // the database can be walked without a recording or a model key.
  useEffect(() => {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !/[?&]demo/.test(location.search)) return;
    if (!roster.length) return;
    const pick = (i, name) => (roster[i] ? { ...roster[i] } : { search: name, ingame: name, alliance: '698W' });
    const demo = [
      { rank: 1, seenRank: 1, name: roster[10] ? roster[10].ingame : 'Alpha', plain: 'Alpha', points: 652, match: pick(10, 'Alpha'), score: 1, seen: 4 },
      { rank: 2, seenRank: 2, name: roster[20] ? roster[20].ingame : 'Bravo', plain: 'Bravo', points: 535, match: pick(20, 'Bravo'), score: 1, near1: true, seen: 3 },
      { rank: 3, seenRank: 3, name: '\u{1F43B}‍❄️', plain: 'polar', points: 490, match: null, score: 0, pick: '', seen: 2 },
      { rank: 5, seenRank: 5, name: 'NewGuy', plain: 'NewGuy', points: 300, match: null, score: 0, pick: '', seen: 3 },
    ];
    setQueue([{ file: new File([''], 'demo.mov'), alliance: '', status: 'waiting', rows: 0 }]);
    setRows(demo.map(r => ({ ...r, pick: r.pick ?? (r.match ? r.match.ingame : '') })));
    setLog('demo rows loaded — not from a recording');
  }, [roster.length]);

  return (
    <div className="screen__in">
      <div className="extract">
        <div className="extract__setup">
          <section className="panel">
            <div className="sectionhead">
              <span className="step">1</span>
              <h2>Roster</h2>
              <span className="spacer" />
              <button className="btn btn--sm"
                      onClick={() => openInData({ kind: 'dataset', key: 'roster' })}>Edit</button>
            </div>
            <div className="rosterstate">
              <b>{matchRoster.length || '—'}</b>
              <span>{matchRoster.length ? 'players a name can be matched to'
                                        : 'the roster is empty — open it in Data and add players'}</span>
            </div>
          </section>

          <section className="panel">
            <div className="sectionhead">
              <span className="step">2</span>
              <h2>Recording</h2>
            </div>
            <div className="stack">
              <div className={'drop' + (dragOn ? ' is-over' : '')}
                   onClick={() => fileInput.current && fileInput.current.click()}
                   onDragOver={e => { e.preventDefault(); setDragOn(true); }}
                   onDragEnter={e => { e.preventDefault(); setDragOn(true); }}
                   onDragLeave={e => { e.preventDefault(); setDragOn(false); }}
                   onDrop={e => { e.preventDefault(); setDragOn(false); pickFiles(e.dataTransfer.files); }}>
                <strong>{queue.length
                  ? (queue.length === 1 ? queue[0].file.name : `${queue.length} recordings`)
                  : 'Choose or drop a recording'}</strong>
                <span>{queue.length
                  ? (queue.reduce((n, q) => n + q.file.size, 0) / 1e6).toFixed(0) + ' MB · tap to change'
                  : 'one per alliance — on a phone this opens your camera roll'}</span>
              </div>
              <input ref={fileInput} type="file" accept="video/*" multiple className="hide"
                     onChange={e => pickFiles(e.target.files)} />

              {queue.length > 1 && (
                <div className="queue">
                  {queue.map((q, i) => (
                    <div key={i} className={'qrow' + (q.status === 'saved' ? ' is-done'
                                                    : q.status === 'failed' ? ' is-failed' : '')}>
                      <span className="qrow__name">{q.file.name}</span>
                      <select value={q.alliance} disabled={q.status === 'saved' || running}
                              onChange={e => setQueue(qs => qs.map((x, k) => (k === i ? { ...x, alliance: e.target.value } : x)))}>
                        <option value="">alliance…</option>
                        {MAIN_ALLIANCES.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <span className="qrow__stat">{q.status === 'saved' ? `${q.rows} rows` : q.status}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="row">
                <div className="field" style={{ flex: '1 1 150px' }}>
                  <label className="label" htmlFor="datestr">Date</label>
                  <input id="datestr" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div className="field" style={{ flex: '1 1 130px' }}>
                  <label className="label" htmlFor="dayslot">Scoring day</label>
                  <select id="dayslot" value={label} onChange={e => setLabel(e.target.value)}>
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <button className="btn btn--primary btn--lg btn--block" disabled={!canRun} onClick={extract}>
                {running ? 'Extracting…'
                  : queue.length > 1 ? `Extract and add ${queue.length} boards`
                  : 'Extract'}
              </button>

              {(running || prog > 0 || log) && (
                <div className="stack stack--tight">
                  <div className="bar"><i style={{ width: (prog * 100) + '%' }} /></div>
                  <div className="runlog">{log}</div>
                </div>
              )}
              {strip.length > 0 && (
                <div className="strip">{strip.map((f, i) => <img key={i} src={'data:image/jpeg;base64,' + f} alt="" />)}</div>
              )}
            </div>
          </section>

          <details className="disclosure">
            <summary>How it works, and what it costs</summary>
            <p className="hint">The browser decodes the video and samples frames onto a canvas,
              keeping only frames where the list actually moved. Those go to a vision model that
              reads rank, name and points, and writes each stylised name out in plain letters.
              That plain form is matched against your roster, so decorated tags resolve without
              anyone retyping them. Roughly a fifth of a cent per recording, and inside the free
              tier in normal use.</p>
          </details>
        </div>

        <div className="extract__results">
          <section className="panel">
            <div className="sectionhead">
              <span className="step">3</span>
              <h2>Review</h2>
              <span className="spacer" />
              {rows && (
                <div className="btnrow">
                  <FlashButton className="btn btn--sm" onClick={copyRows}>Copy rows</FlashButton>
                  <FlashButton className="btn btn--sm" onClick={remember}>Remember fixes</FlashButton>
                  <button className="btn btn--primary" onClick={addToData}>
                    Add {keptRows(rows).length} to the data
                  </button>
                </div>
              )}
            </div>
            {rows
              ? <ReviewTable rows={rows} setRows={setRows} roster={roster}
                             allianceAll={allianceAll} setAllianceAll={setAllianceAll} />
              : <Empty title="Nothing extracted yet">
                  Choose a recording and press Extract. The rows appear here to check before they
                  go anywhere, and then they go straight into the database.
                </Empty>}
          </section>
        </div>
      </div>

      {committing && (
        <CommitDialog payload={committing} onClose={() => setCommitting(null)}
                      onDone={async board => {
                        setCommitting(null);
                        await refreshDatasets();
                        openInData({ kind: 'dataset', key: 'board:' + board });
                      }} />
      )}
    </div>
  );
}
