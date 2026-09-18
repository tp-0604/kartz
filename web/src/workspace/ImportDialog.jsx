/**
 * Bringing data in.
 *
 * Three things arrive here and they are genuinely different jobs: a table that belongs in the
 * dataset you have open, the whole Google Sheets workbook full of months that predate this app,
 * and an empty board to start typing into.
 *
 * What they share is the rule: nothing is written until you have seen what would be written.
 * Every one of these shows the columns it found, the rows it would create, and what it thinks is
 * wrong with them, and then waits.
 */
import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { parseTable } from '../services/importer.js';
import { createBoard } from '../services/api.js';
import { DAYS, MAIN_ALLIANCES } from '../extractor/config.js';
import { today } from '../utils/format.js';
import WorkbookImport from './WorkbookImport.jsx';

const TABS = [
  ['table', 'A table into this dataset'],
  ['workbook', 'The whole tracking workbook'],
  ['board', 'A new empty board'],
];

const text = v => (v === null || v === undefined ? '' : String(v).trim());

export default function ImportDialog({ mode, dataset, columns, onClose, onDone, onImportRows, canReplace, isAdmin }) {
  const [tab, setTab] = useState(mode === 'board' ? 'board' : 'table');
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog dialog--wide" role="dialog" aria-modal="true" aria-label="Import">
        <div className="dialog__head">
          <h2>Import</h2>
          <div className="nav" style={{ marginLeft: 'auto' }}>
            {/* The whole workbook replaces the roster and many boards at once: an admin's job. */}
            {TABS.filter(([id]) => isAdmin || id !== 'workbook').map(([id, label]) => (
              <button key={id} type="button" className="nav__item" aria-current={tab === id ? 'page' : undefined}
                      style={{ textTransform: 'none', letterSpacing: 0 }}
                      onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          <button className="btn btn--sm btn--quiet" onClick={onClose}>Close</button>
        </div>
        <div className="dialog__body">
          {tab === 'table' && <TableImport dataset={dataset} columns={columns} canReplace={canReplace}
                                           onImportRows={onImportRows} onDone={onDone} />}
          {tab === 'workbook' && <WorkbookImport onDone={onDone} />}
          {tab === 'board' && <NewBoard onDone={onDone} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// A table into the dataset that is open
// ---------------------------------------------------------------------------------------
function TableImport({ dataset, columns, onImportRows, onDone, canReplace }) {
  const { notify } = useApp();
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [pick, setPick] = useState(0);
  const [pasted, setPasted] = useState('');
  const [table, setTable] = useState(null);
  const [map, setMap] = useState({});              // source heading → dataset column key, or '+' to add
  const [how, setHow] = useState('append');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dragOn, setDragOn] = useState(false);
  const input = useRef(null);

  const take = (rows, name) => {
    const at = rows.findIndex(r => r.filter(c => text(c)).length > 1);
    if (at < 0) throw new Error(`${name} has no table in it.`);
    const block = rows.slice(at);
    const head = (block[0] || []).map(text);
    const width = head.reduce((w, h, i) => (h ? i + 1 : w), 0);
    const headings = head.slice(0, width);
    setTable({ headings, body: block.slice(1) });
    // A heading that matches a column of this dataset is that column; anything else is offered
    // as a new column rather than dropped, because an unknown column is still the user's data.
    const guess = {};
    for (const h of headings) {
      const hit = columns.find(c => c.header.toLowerCase() === h.toLowerCase())
               || columns.find(c => c.header.toLowerCase().replace(/\s+/g, '') === h.toLowerCase().replace(/\s+/g, ''));
      guess[h] = hit ? hit.key : '+';
    }
    setMap(guess);
  };

  const readFile = async f => {
    if (!f) return;
    setErr(''); setFile(f); setBusy(true); setTable(null); setSheets(null); setPasted('');
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const { readXlsx } = await import('../services/xlsx.js');
        const out = await readXlsx(f);
        if (!out.sheets.length) throw new Error('That workbook has no readable tabs.');
        setSheets(out.sheets); setPick(0);
        take(out.sheets[0].rows, out.sheets[0].name);
      } else take(parseTable(await f.text()), f.name);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const plan = useMemo(() => {
    if (!table) return null;
    const used = table.headings.map(h => map[h]).filter(k => k && k !== '-');
    const newColumns = table.headings.filter(h => map[h] === '+');
    const keyFor = h => (map[h] === '+' ? 'x:' + h : map[h]);
    const rows = [];
    for (const line of table.body) {
      const row = {};
      let any = false;
      table.headings.forEach((h, i) => {
        if (!map[h] || map[h] === '-') return;
        const v = text(line[i]);
        if (v) any = true;
        row[keyFor(h)] = v || null;
      });
      if (any) rows.push(row);
    }
    // What the save would refuse, said now.
    const issues = [];
    if (dataset && dataset.kind === 'roster') {
      const seen = new Set();
      let blank = 0, dupe = 0;
      for (const r of rows) {
        const name = text(r.search);
        if (!name) { blank++; continue; }
        if (seen.has(name.toLowerCase())) dupe++; else seen.add(name.toLowerCase());
      }
      if (!used.includes('search')) issues.push('No column is mapped to the player name, which is the identity every score points at.');
      if (blank) issues.push(`${blank} row${blank > 1 ? 's have' : ' has'} no player name and would be skipped.`);
      if (dupe) issues.push(`${dupe} row${dupe > 1 ? 's share' : ' shares'} a player name with another; only the first of each would be stored.`);
    } else {
      const seen = new Set();
      let noRank = 0, dupe = 0;
      for (const r of rows) {
        const p = Number(String(r.place ?? '').replace(/[,\s]/g, ''));
        if (!Number.isFinite(p) || p <= 0) { noRank++; continue; }
        if (seen.has(p)) dupe++; else seen.add(p);
      }
      if (!used.includes('place')) issues.push('No column is mapped to Rank.');
      if (!used.includes('ingame')) issues.push('No column is mapped to Name in video.');
      if (noRank) issues.push(`${noRank} row${noRank > 1 ? 's have' : ' has'} no rank.`);
      if (dupe) issues.push(`${dupe} row${dupe > 1 ? 's repeat' : ' repeats'} a rank already in the file.`);
    }
    return { rows, newColumns, issues };
  }, [table, map, dataset]);

  const run = async () => {
    if (!plan || !plan.rows.length) return;
    if (how === 'replace' && !window.confirm(
      `Replace all ${dataset ? dataset.rows : 0} rows with the ${plan.rows.length} in this file?`)) return;
    setBusy(true);
    try {
      await onImportRows({ rows: plan.rows, newColumns: plan.newColumns, mode: how });
      notify(`Imported ${plan.rows.length.toLocaleString()} rows ✓`);
      onDone(null);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <p className="hint">The table comes in as it is. Say which of its columns is which; anything
        this dataset does not have can be added as a column of its own rather than thrown away.
        Nothing is written until you press the button at the bottom.</p>

      <div className={'drop' + (dragOn ? ' is-over' : '')}
           onClick={() => input.current && input.current.click()}
           onDragOver={e => { e.preventDefault(); setDragOn(true); }}
           onDragLeave={e => { e.preventDefault(); setDragOn(false); }}
           onDrop={e => { e.preventDefault(); setDragOn(false); readFile(e.dataTransfer.files[0]); }}>
        <strong>{file ? file.name : 'Choose or drop a spreadsheet'}</strong>
        <span>{busy ? 'reading…' : '.xlsx or .csv — in Google Sheets, File → Download'}</span>
      </div>
      <input ref={input} type="file" className="hide" accept=".xlsx,.xls,.csv,.tsv,text/csv"
             onChange={e => readFile(e.target.files[0])} />

      <div className="field">
        <label className="label" htmlFor="tpaste">…or copy the cells and paste them here</label>
        <textarea id="tpaste" value={pasted} onChange={e => setPasted(e.target.value)} spellCheck={false}
                  placeholder={'Rank\tPlayer\tName in video\tKartz Points'} />
        <div className="btnrow">
          <button className="btn btn--sm" disabled={!pasted.trim()}
                  onClick={() => { try { setErr(''); setFile(null); setSheets(null); take(parseTable(pasted), 'the pasted cells'); }
                                   catch (e) { setErr(e.message); } }}>Read the paste</button>
        </div>
      </div>

      {err && <div className="note note--bad">{err}</div>}

      {sheets && sheets.length > 1 && (
        <div className="field">
          <label className="label" htmlFor="wtab">Which tab</label>
          <select id="wtab" value={pick}
                  onChange={e => { const i = +e.target.value; setPick(i);
                                   try { take(sheets[i].rows, sheets[i].name); setErr(''); }
                                   catch (x) { setErr(x.message); setTable(null); } }}>
            {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
          </select>
        </div>
      )}

      {table && plan && (
        <>
          <div className="note note--flat">
            {table.headings.length} columns and {table.body.length.toLocaleString()} rows found.
            {plan.newColumns.length ? ` ${plan.newColumns.length} would be added as new columns.` : ''}
          </div>

          <div className="stack stack--tight">
            <span className="label">Column mapping</span>
            {table.headings.map(h => (
              <div key={h} className="maprow">
                <span className="truncate" title={h} style={{ fontWeight: 600 }}>{h}</span>
                <select className="input--sm" value={map[h] || '-'}
                        onChange={e => setMap(m => ({ ...m, [h]: e.target.value }))}>
                  <option value="-">skip this column</option>
                  <option value="+">add as a new column</option>
                  {columns.map(c => <option key={c.key} value={c.key}>{c.header}</option>)}
                </select>
                <span className="hint truncate">
                  {(table.body.slice(0, 3).map(r => text(r[table.headings.indexOf(h)])).filter(Boolean).join(' · ')) || 'empty'}
                </span>
              </div>
            ))}
          </div>

          {plan.issues.length > 0 && (
            <div className="note note--warn">
              <ul>{plan.issues.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}

          <div className="row">
            <label className="check">
              <input type="radio" name="how" checked={how === 'append'} onChange={() => setHow('append')} />
              <span>Add these rows to what is there</span>
            </label>
            <label className="check" style={canReplace ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}>
              <input type="radio" name="how" checked={how === 'replace'} disabled={!canReplace}
                     onChange={() => setHow('replace')} />
              <span>Replace every row with these</span>
            </label>
            {!canReplace && (
              <span className="hint">Replacing every row is for an admin, or whoever sent this board.</span>
            )}
          </div>

          <div className="btnrow">
            <button className="btn btn--primary btn--lg" disabled={busy || !plan.rows.length} onClick={run}>
              {busy ? 'Importing…' : `${how === 'replace' ? 'Replace with' : 'Add'} ${plan.rows.length.toLocaleString()} rows`}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------
// A new, empty board
// ---------------------------------------------------------------------------------------
function NewBoard({ onDone }) {
  const { notify } = useApp();
  const [date, setDate] = useState(today());
  const [alliance, setAlliance] = useState(MAIN_ALLIANCES[0]);
  const [label, setLabel] = useState(DAYS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const make = async () => {
    setBusy(true); setErr('');
    try {
      const out = await createBoard({ date, alliance, label, rows: [], allowEmpty: true });
      notify('Board created — type into it, or paste a block in.');
      onDone('board:' + out.board);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <p className="hint">An empty board to type or paste into. Most boards arrive from a recording
        instead — Extract, check the names, then add them to the data.</p>
      <div className="maprow">
        <span className="label">Filmed on</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <span className="hint">the day the ranking list was recorded</span>
      </div>
      <div className="maprow">
        <span className="label">Alliance</span>
        <select value={alliance} onChange={e => setAlliance(e.target.value)}>
          {MAIN_ALLIANCES.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="hint">whose board this is</span>
      </div>
      <div className="maprow">
        <span className="label">Scoring day</span>
        <select value={label} onChange={e => setLabel(e.target.value)}>
          <option value="">—</option>
          {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="hint">which of the month's three recordings</span>
      </div>
      {err && <div className="note note--bad">{err}</div>}
      <div className="btnrow">
        <button className="btn btn--primary btn--lg" disabled={busy} onClick={make}>
          {busy ? 'Creating…' : 'Create the board'}
        </button>
      </div>
    </>
  );
}
