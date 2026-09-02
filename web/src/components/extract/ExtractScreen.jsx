// Screen recording → rows. Done one-handed on a phone in front of the game, so the controls
// are large and the sequence is numbered: roster, recording, results.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { runExtraction } from '../../extractor/run.js';
import { aliasKey } from '../../extractor/matching.js';
import { DAYS, MAIN_ALLIANCES } from '../../extractor/config.js';
import { saveRun } from '../../services/api.js';
import { extractedToRecord } from '../../sheet/columns.js';
import ReviewTable, { keptRows, makeOutName } from './ReviewTable.jsx';
import { FlashButton, Pill } from '../shared/ui.jsx';

export default function ExtractScreen() {
  const { roster, matchRoster, pullRoster, aliases, setAliases, date, setDate, notify, stage, refreshBoards, go } = useApp();
  const [queue, setQueue] = useState([]);              // [{ file, alliance, status, rows }]
  const [label, setLabel] = useState(DAYS[0]);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState(0);
  const [log, setLog] = useState('');
  const [strip, setStrip] = useState([]);
  const [rows, setRows] = useState(null);
  const [allianceAll, setAllianceAll] = useState('');
  const [dragOn, setDragOn] = useState(false);
  const fileInput = useRef(null);
  const outName = makeOutName(roster);

  const pickFiles = list => {
    const files = [...(list || [])].filter(f => f && f.size);
    if (!files.length) return;
    setQueue(files.map(f => ({ file: f, alliance: '', status: 'waiting', rows: 0 })));
    setRows(null); setStrip([]); setLog(''); setProg(0);
  };
  const single = queue.length === 1 ? queue[0].file : null;
  const canRun = matchRoster.length > 0 && queue.length > 0 && !running;

  const runOne = async file => runExtraction({
    file, roster: matchRoster, aliases,
    onLog: setLog, onProgress: setProg, onFrames: setStrip,
  });

  const payloadFor = (rs, alliance) => ({
    date, alliance, label: label || null,
    rows: keptRows(rs).map(r => extractedToRecord(r, outName)),
  });

  const extract = async () => {
    setRunning(true); setRows(null);
    try {
      if (queue.length > 1) {
        // The queue: four recordings is what a month actually is. Each board is saved before
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
            const j = await saveRun(payloadFor(rs, q.alliance));
            setQ(i, { status: 'saved', rows: j.saved });
            ok++;
          } catch (e) {
            setQ(i, { status: 'failed' });
            setLog(`✗ ${q.file.name}: ${e.message}`);
          }
        }
        setLog(`queue finished — ${ok} of ${queue.length} boards saved`);
        refreshBoards().catch(() => {});
        return;
      }
      const out = await runOne(single);
      let rs = out.rows;
      let alli = allianceAll;
      if (!alli && out.suggestedAlliance) alli = out.suggestedAlliance;
      if (alli) rs = rs.map(r => ({ ...r, alliancePick: alli }));
      setAllianceAll(alli);
      setRows(rs);
      setLog(`done — ${out.readings} readings → ${rs.length} players`
        + (alli ? ` · alliance set to ${alli}, change it above the table if wrong` : ''));
    } catch (e) {
      const m = e.message || String(e);
      setLog(/\b429\b/.test(m) && /quota|per day/i.test(m)
        ? '✗ Daily free-tier quota used up. Wait for the reset, or enable billing on the key.'
        : '✗ ' + m);
    } finally { setRunning(false); }
  };

  const needAlliance = () => {
    if (allianceAll) return true;
    notify('Pick the alliance at the top of the Alliance column first — a board belongs to one alliance.', 'warn');
    return false;
  };

  const openInSheet = () => {
    const records = keptRows(rows).map(r => extractedToRecord(r, outName));
    if (!records.length) { notify('Nothing to send — every row is excluded.', 'warn'); return; }
    stage({ kind: 'records', meta: { id: null, date, alliance: allianceAll, label, version: null }, records, source: 'extract' });
  };

  const saveToDb = async () => {
    if (!needAlliance()) throw new Error('Pick an alliance first');
    const payload = payloadFor(rows, allianceAll);
    if (!payload.rows.length) throw new Error('nothing to save');
    const j = await saveRun(payload);
    refreshBoards().catch(() => {});
    setLog(`saved ${j.saved} rows for ${payload.alliance} on ${payload.date}` + (j.kept ? ` — ${j.kept} hand-corrected row(s) kept` : ''));
    return `Saved ${j.saved} ✓`;
  };

  const copyRows = async () => {
    const out = keptRows(rows).map(r => [date, r.rank, outName(r), r.points].join('\t')).join('\n');
    try { await navigator.clipboard.writeText(out); return `Copied ${keptRows(rows).length} rows ✓`; }
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
    setLog(n ? `remembered ${n} name${n > 1 ? 's' : ''} — they will match automatically next time` : 'nothing new to remember');
    return n ? `Remembered ${n} ✓` : 'Nothing new';
  };

  useEffect(() => { if (!queue.length) setRows(null); }, [queue.length]);

  // ?demo on localhost loads a few made-up rows into the review table, so the path from here
  // to the sheet and the database can be walked without a recording or a model key.
  useEffect(() => {
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || !/[?&]demo/.test(location.search)) return;
    if (!roster.length) return;
    const pick = (i, name) => roster[i] ? { ...roster[i] } : { search: name, ingame: name, alliance: '698W' };
    const demo = [
      { rank: 1, seenRank: 1, name: roster[10] ? roster[10].ingame : 'Alpha', plain: 'Alpha', points: 652, match: pick(10, 'Alpha'), score: 1, seen: 4 },
      { rank: 2, seenRank: 2, name: roster[20] ? roster[20].ingame : 'Bravo', plain: 'Bravo', points: 535, match: pick(20, 'Bravo'), score: 1, near1: true, seen: 3 },
      { rank: 3, seenRank: 3, name: '\u{1F43B}\u200D\u2744\uFE0F', plain: 'polar', points: 490, match: null, score: 0, pick: '', seen: 2 },
      { rank: 5, seenRank: 5, name: 'NewGuy', plain: 'NewGuy', points: 300, match: null, score: 0, pick: '', seen: 3 },
    ];
    setQueue([{ file: new File([''], 'demo.mov'), alliance: '', status: 'waiting', rows: 0 }]);
    setRows(demo.map(r => ({ ...r, pick: r.pick ?? (r.match ? r.match.ingame : '') })));
    setLog('demo rows loaded — not from a recording');
  }, [roster.length]);

  return (
    <>
      <div className="screenhead">
        <h1>Extract</h1>
        <p className="lede">Screen recording → rows. Your video never leaves the phone; only a handful of cropped frames go to the model.
          Review the rows, then open them in the sheet or save them straight to the database.</p>
      </div>

      <section>
        <div className="step"><span className="stepn">1</span><h2>Roster</h2>
          <Pill kind={matchRoster.length ? 'ok' : 'new'}>{matchRoster.length ? `${matchRoster.length} roster names` : 'not pulled yet'}</Pill>
          <FlashButton className="ghost sm" style={{ marginLeft: 'auto' }}
            onClick={async () => { const c = await pullRoster(); return `${c.all.length} rows ✓`; }}>
            Pull / update from the sheet
          </FlashButton>
        </div>
        <p className="note" style={{ marginTop: 0 }}>Names are matched against the alliance's Google Sheet, with any corrections made on the Roster screen applied.
          Pull again whenever players join.</p>
      </section>

      <section>
        <div className="step"><span className="stepn">2</span><h2>Recording</h2></div>
        <div className={'drop' + (dragOn ? ' on' : '')}
             onClick={() => fileInput.current && fileInput.current.click()}
             onDragOver={e => { e.preventDefault(); setDragOn(true); }} onDragEnter={e => { e.preventDefault(); setDragOn(true); }}
             onDragLeave={e => { e.preventDefault(); setDragOn(false); }}
             onDrop={e => { e.preventDefault(); setDragOn(false); pickFiles(e.dataTransfer.files); }}>
          <strong>{queue.length ? (queue.length === 1 ? queue[0].file.name : `${queue.length} recordings`) : 'Choose or drop the screen recordings'}</strong>
          <span>{queue.length
            ? (queue.reduce((n, q) => n + q.file.size, 0) / 1e6).toFixed(0) + ' MB · tap to change'
            : 'one per alliance — on a phone this opens your camera roll'}</span>
        </div>
        <input ref={fileInput} type="file" accept="video/*" multiple className="hide" onChange={e => pickFiles(e.target.files)} />

        {queue.length > 1 && (
          <div id="queue">
            {queue.map((q, i) => (
              <div key={i} className={'qrow' + (q.status === 'saved' ? ' qdone' : q.status === 'failed' ? ' qfail' : '')}>
                <span className="qname">{q.file.name}</span>
                <select value={q.alliance} disabled={q.status === 'saved' || running}
                        onChange={e => setQueue(qs => qs.map((x, k) => (k === i ? { ...x, alliance: e.target.value } : x)))}>
                  <option value="">alliance…</option>
                  {MAIN_ALLIANCES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <span className="qstat">{q.status === 'saved' ? `${q.rows} rows saved` : q.status}</span>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <div><label htmlFor="datestr">Date</label><input id="datestr" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div><label htmlFor="dayslot">Scoring day</label>
            <select id="dayslot" value={label} onChange={e => setLabel(e.target.value)}>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <button id="go" disabled={!canRun} onClick={extract}>
          {running ? 'Extracting…' : queue.length > 1 ? `Extract and save ${queue.length} boards` : 'Extract'}
        </button>
        <div className="bar"><i style={{ width: (prog * 100) + '%' }} /></div>
        <div className="log">{log}</div>
        {strip.length > 0 && <div className="strip">{strip.map((f, i) => <img key={i} src={'data:image/jpeg;base64,' + f} alt="" />)}</div>}
      </section>

      {rows && (
        <section id="out">
          <div className="step"><span className="stepn">3</span><h2>Results</h2></div>
          <ReviewTable rows={rows} setRows={setRows} roster={roster} allianceAll={allianceAll} setAllianceAll={setAllianceAll} />
          <div className="btnrow">
            <button onClick={openInSheet}>Open in sheet →</button>
            <FlashButton className="ghost" onClick={saveToDb}>Save to database</FlashButton>
            <FlashButton className="ghost" onClick={copyRows}>Copy rows</FlashButton>
            <FlashButton className="ghost" onClick={remember}>Remember my fixes</FlashButton>
          </div>
          <p className="note">Open in sheet puts these rows in the workbook to edit, format and save. Save to database stores them as they are.
            Anything you resolve by hand, then keep with <em>Remember my fixes</em>, is matched automatically from the next run onward.</p>
        </section>
      )}

      <details>
        <summary>How it works &amp; costs</summary>
        <p className="note">The browser decodes the video with a plain <code>&lt;video&gt;</code> element and samples frames onto a canvas,
          keeping only frames where the list actually moved. Those frames go to a vision model that reads rank, name and points, and
          also writes each stylised name out in plain letters. That plain form is matched against your roster, so decorated tags
          resolve without anyone retyping them. Roughly a fifth of a cent per recording on Gemini Flash, and inside the free tier in normal use.
          {' '}<a href="#" onClick={e => { e.preventDefault(); go('roster'); }}>See the roster</a>.</p>
      </details>
    </>
  );
}
