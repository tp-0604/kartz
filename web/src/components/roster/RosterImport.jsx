// Replacing the roster from a table that lives somewhere else.
//
// A spreadsheet file, or a block of cells copied out of one. The table comes in exactly as it
// is — every column, in its own order — and the only thing asked is which of its columns is the
// player name, which is the name a recording is matched against, and which is the alliance.
//
// Nothing is written to the database here. The table is loaded into the roster sheet, where it
// can be looked at, and Save is still Save.
import { useMemo, useRef, useState } from 'react';
import { parseTable } from '../../services/importer.js';
import { guessMapping } from '../../sheet/roster.js';

const text = v => (v === null || v === undefined ? '' : String(v).trim());

export default function RosterImport({ onLoad, onClose }) {
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);      // [{ name, rows }] from a workbook
  const [pick, setPick] = useState(0);
  const [pasted, setPasted] = useState('');
  const [table, setTable] = useState(null);        // the chosen 2-D block
  const [map, setMap] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOn, setDragOn] = useState(false);
  const input = useRef(null);

  const take = (rows, name) => {
    // The heading row is the first row with more than one thing in it.
    const at = rows.findIndex(r => r.filter(c => text(c)).length > 1);
    if (at < 0) throw new Error(`${name} has no table in it.`);
    const block = rows.slice(at);
    const head = (block[0] || []).map(text);
    setTable(block);
    setMap(guessMapping(head.filter(Boolean)));
  };

  const readFile = async f => {
    if (!f) return;
    setErr(''); setFile(f); setBusy(true); setTable(null); setSheets(null); setPasted('');
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const { readXlsx } = await import('../../services/xlsx.js');
        const out = await readXlsx(f);
        if (!out.sheets.length) throw new Error('That workbook has no readable tabs.');
        setSheets(out.sheets);
        setPick(0);
        take(out.sheets[0].rows, out.sheets[0].name);
      } else {
        take(parseTable(await f.text()), f.name);
      }
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const readPaste = () => {
    setErr(''); setFile(null); setSheets(null);
    try {
      if (!pasted.trim()) throw new Error('Paste the cells first.');
      take(parseTable(pasted), 'the pasted cells');
    } catch (e) { setErr(e.message || String(e)); setTable(null); }
  };

  const chooseSheet = i => {
    setPick(i);
    try { take(sheets[i].rows, sheets[i].name); setErr(''); }
    catch (e) { setErr(e.message); setTable(null); }
  };

  const summary = useMemo(() => {
    if (!table || !map) return null;
    const head = (table[0] || []).map(text);
    const width = head.reduce((w, h, i) => (h ? i + 1 : w), 0);
    const columns = head.slice(0, width);
    const iSearch = columns.indexOf(map.search);
    if (iSearch < 0) return { columns, error: 'Choose which column holds the player name.' };
    const seen = new Map();
    let players = 0, dupes = [];
    for (let r = 1; r < table.length; r++) {
      const name = text((table[r] || [])[iSearch]);
      if (!name) continue;
      players++;
      if (seen.has(name)) { if (dupes.length < 12) dupes.push(name); } else seen.set(name, r);
    }
    return { columns, players, unique: seen.size, dupes };
  }, [table, map]);

  const load = () => {
    const head = (table[0] || []).map(text);
    const width = head.reduce((w, h, i) => (h ? i + 1 : w), 0);
    const columns = head.slice(0, width);
    onLoad({ values: table.map(r => columns.map((_, i) => text(r[i]))), columns, mapping: map });
    onClose();
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog dialog--wide" role="dialog" aria-modal="true" aria-label="Replace the roster">
        <div className="dialog__head">
          <h2>Replace the roster</h2>
          <button className="btn btn--sm btn--quiet" onClick={onClose}>Close</button>
        </div>

        <div className="dialog__body">
          <p className="hint">The table comes in exactly as it is — every column, in its own order. Say which of its
            columns the app should treat as the player name, the name in video and the alliance. Nothing is saved
            until you press Save on the roster.</p>

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
            <label className="label" htmlFor="rpaste">…or copy the cells and paste them here</label>
            <textarea id="rpaste" value={pasted} onChange={e => setPasted(e.target.value)}
                      placeholder={'Player\tName in video\tAlliance\tCP\t…'} spellCheck={false} />
            <div className="btnrow"><button className="btn" onClick={readPaste}>Read the paste</button></div>
          </div>

          {err && <div className="note note--bad">{err}</div>}

          {sheets && sheets.length > 1 && (
            <div className="field">
              <label className="label" htmlFor="rtab">Which tab</label>
              <select id="rtab" value={pick} onChange={e => chooseSheet(+e.target.value)}>
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} rows)</option>)}
              </select>
            </div>
          )}

          {summary && (
            <>
              <div className="note note--flat">
                {summary.columns.length} columns: {summary.columns.join(' · ')}
              </div>
              <div className="maprows">
                {[['search', 'Player name', 'the identity every score points at'],
                  ['ingame', 'Name in video', 'what a recording is matched against'],
                  ['alliance', 'Alliance', 'optional']].map(([key, label, why]) => (
                  <div key={key} className="mapping__row">
                    <span className="mapping__role">{label}</span>
                    <select value={map[key] || ''} onChange={e => setMap(m => ({ ...m, [key]: e.target.value }))}>
                      <option value="">{key === 'search' ? 'choose…' : 'none'}</option>
                      {summary.columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="hint">{why}</span>
                  </div>
                ))}
              </div>

              {summary.error
                ? <div className="note note--warn">{summary.error}</div>
                : (
                  <>
                    <div className={'note ' + (summary.dupes.length ? 'note--warn' : 'note--ok')}>
                      {summary.players} rows with a player name, {summary.unique} of them distinct.
                      {summary.dupes.length
                        ? ` ${summary.players - summary.unique} share a name with another row and would not all be stored: ${summary.dupes.join(', ')}${summary.players - summary.unique > summary.dupes.length ? '…' : ''}. Rename them in the sheet before saving.`
                        : ' Every name is unique, so every row will be stored.'}
                    </div>
                    <div className="btnrow">
                      <button className="btn btn--primary btn--lg" onClick={load}>
                        Put {summary.players} rows in the roster sheet
                      </button>
                    </div>
                  </>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
