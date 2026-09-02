// Backloading boards from the Kartz Tracking workbook: a tab's link or its pasted cells in,
// a preview of the boards it makes, one press to save them.
import { useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { sheetCsvUrl } from '../../extractor/roster.js';
import { parseTable, detectLayout, buildBoards } from '../../services/importer.js';
import { createBoard } from '../../services/api.js';
import { MAIN_ALLIANCES } from '../../extractor/config.js';
import { today } from '../../utils/format.js';
import { AllianceChip, FlashButton } from '../shared/ui.jsx';
import WorkbookImport from './WorkbookImport.jsx';

const KIND_TEXT = {
  days: 'one row per player, with a column per scoring day',
  flat: 'flat rows: a date and points on every row',
};

export default function ImportScreen() {
  const [mode, setMode] = useState('workbook');
  return (
    <>
      <div className="tabs" style={{ marginTop: 4 }}>
        <button className={'tab' + (mode === 'workbook' ? ' on' : '')} onClick={() => setMode('workbook')}>Whole workbook</button>
        <button className={'tab' + (mode === 'tab' ? ' on' : '')} onClick={() => setMode('tab')}>One tab</button>
      </div>
      {mode === 'workbook' ? <WorkbookImport /> : <SingleTabImport />}
    </>
  );
}

function SingleTabImport() {
  const { matchRoster, refreshBoards, notify } = useApp();
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [table, setTable] = useState(null);
  const [layout, setLayout] = useState(null);
  const [day1, setDay1] = useState(today());
  const [alliance, setAlliance] = useState('');
  const [replace, setReplace] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState('');

  const read = async () => {
    setErr(''); setResults(null);
    try {
      let raw = text;
      if (link.trim()) {
        const r = await fetch(sheetCsvUrl(link.trim()));
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403
          ? 'That tab is not readable by link. Share → Anyone with the link → Viewer.'
          : 'Could not read the sheet (' + r.status + ').');
        raw = await r.text();
        if (/^\s*<(!doctype|html)/i.test(raw)) throw new Error('Google returned a sign-in page — the sheet is not link-readable.');
        setText('');
      }
      if (!raw.trim()) throw new Error('Paste the tab, or give its link.');
      const rows = parseTable(raw);
      const lay = detectLayout(rows);
      if (!lay || !lay.kind) throw new Error('Could not recognise those columns. Expected Day 1 / Day 4 / Final score columns, or Date, Rank and Points.');
      setTable(rows); setLayout(lay);
    } catch (e) { setErr(e.message); setTable(null); setLayout(null); }
  };

  const boards = table && layout
    ? buildBoards(table, layout, { day1, alliance, roster: matchRoster })
    : [];
  const needAlliance = layout && layout.kind === 'days' && layout.alliance < 0 && !alliance;
  const totalRows = boards.reduce((n, b) => n + b.rows.length, 0);
  const unmatched = boards.reduce((n, b) => n + b.unmatched, 0);

  const importAll = async () => {
    if (!boards.length) throw new Error('nothing to import');
    const out = [];
    for (const b of boards) {
      try {
        const j = await createBoard({ date: b.date, alliance: b.alliance, label: b.label, rows: b.rows, replace });
        out.push({ ...b, ok: true, saved: j.saved });
      } catch (e) {
        out.push({ ...b, ok: false, error: e.status === 409 ? 'already saved — tick Replace to overwrite' : e.message });
      }
    }
    setResults(out);
    refreshBoards().catch(() => {});
    const ok = out.filter(x => x.ok).length;
    notify(`Imported ${ok} of ${out.length} boards`);
    return `Imported ${ok} ✓`;
  };

  return (
    <section>
      <div className="shead"><h2>Import one tab</h2></div>
      <p className="note" style={{ marginTop: 0 }}>
        One tab at a time, straight from Google. Paste the tab's link (the sheet must be link-readable, and the link must
        include the tab's <code>gid</code>), or select the tab's cells in Sheets, copy, and paste them below. Nothing is saved until you press Import.
      </p>
      <div className="importgrid">
        <div>
          <label htmlFor="implink">Tab link</label>
          <input id="implink" value={link} onChange={e => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…" spellCheck={false} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="imptext">…or paste the cells</label>
        <textarea id="imptext" className="paste" value={text} onChange={e => setText(e.target.value)} placeholder={'Searchable Name\tGame Name\tCP\tMM/CE\tAlliance\tDay 1 Score\t…'} spellCheck={false} />
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button onClick={read}>Read it</button>
      </div>
      {err && <div className="problems" style={{ marginTop: 12 }}>{err}</div>}

      {layout && (
        <>
          <div className="okbox">Recognised {KIND_TEXT[layout.kind]} — {table.length - 1} rows, {layout.days.length || 1} score column{(layout.days.length || 1) === 1 ? '' : 's'}.</div>
          <div className="mapping">
            {layout.kind !== 'flat' && (
              <>
                <span className="role">Day 1 was</span>
                <div><input type="date" value={day1} onChange={e => setDay1(e.target.value)} style={{ width: 170 }} />
                  <span className="inline-note" style={{ marginLeft: 10 }}>Day 4 is three days later and the Final six, as the tracking sheet has always had them.</span></div>
              </>
            )}
            {layout.alliance < 0 && (
              <>
                <span className="role">Alliance</span>
                <select value={alliance} onChange={e => setAlliance(e.target.value)} style={{ width: 'auto' }}>
                  <option value="">{layout.kind === 'flat' ? 'from the roster' : 'choose…'}</option>
                  {MAIN_ALLIANCES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </>
            )}
            <span className="role">Existing</span>
            <label className="colopt" style={{ margin: 0 }}>
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
              <span>Replace boards already saved for the same date and alliance</span>
            </label>
          </div>

          {needAlliance ? <div className="warnbox">Choose which alliance this tab belongs to.</div> : (
            <>
              <div className="rowmsg">{boards.length} board{boards.length === 1 ? '' : 's'} · {totalRows} rows
                {unmatched ? ` · ${unmatched} names not on the roster (kept as written, with no roster name)` : ' · every name matched the roster'}</div>
              <div className="previewlist">
                {boards.map(b => {
                  const r = results && results.find(x => x.date === b.date && x.alliance === b.alliance && x.label === b.label);
                  return (
                    <div key={b.date + b.alliance + b.label} className="previewrow">
                      <AllianceChip a={b.alliance} />
                      <span><b>{b.date}</b> · {b.label || 'no day'} · top {Math.max(...b.rows.map(x => x.points)).toLocaleString()}</span>
                      <span className="st">{b.rows.length} rows{b.unmatched ? ` · ${b.unmatched} new` : ''}</span>
                      <span className={'st ' + (r ? (r.ok ? 'ok' : 'bad') : '')}>{r ? (r.ok ? `saved ${r.saved} ✓` : r.error) : ''}</span>
                    </div>
                  );
                })}
              </div>
              <div className="btnrow">
                <FlashButton onClick={importAll} disabled={!boards.length}>Import {boards.length} board{boards.length === 1 ? '' : 's'}</FlashButton>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
