// Backloading: the whole workbook, or one tab at a time.
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
  flat: 'flat rows, with a date and points on every row',
};

export default function ImportScreen() {
  const [mode, setMode] = useState('workbook');
  return (
    <div className="stack">
      <div className="chips">
        <button className={'chip' + (mode === 'workbook' ? ' is-on' : '')} onClick={() => setMode('workbook')}>Whole workbook</button>
        <button className={'chip' + (mode === 'tab' ? ' is-on' : '')} onClick={() => setMode('tab')}>One tab</button>
      </div>
      {mode === 'workbook' ? <WorkbookImport /> : <SingleTabImport />}
    </div>
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
      if (!lay || !lay.kind) throw new Error('Could not recognise those columns. Expected Day 1 / Day 4 / Final score columns, or Date and Points.');
      setTable(rows); setLayout(lay);
    } catch (e) { setErr(e.message); setTable(null); setLayout(null); }
  };

  const boards = table && layout ? buildBoards(table, layout, { day1, alliance, roster: matchRoster }) : [];
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
    <div className="stack">
      <div className="panel">
        <div className="sectionhead">
          <h2>Import one tab</h2>
          <p>Straight from Google. Paste the tab's link — the sheet must be link-readable and the link must include the
            tab's <code>gid</code> — or select the tab's cells in Sheets, copy, and paste them below.</p>
        </div>
        <div className="stack">
          <div className="field">
            <label className="label" htmlFor="implink">Tab link</label>
            <input id="implink" value={link} onChange={e => setLink(e.target.value)}
                   placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…" spellCheck={false} />
          </div>
          <div className="field">
            <label className="label" htmlFor="imptext">…or paste the cells</label>
            <textarea id="imptext" value={text} onChange={e => setText(e.target.value)}
                      placeholder={'Searchable Name\tGame Name\tCP\tMM/CE\tAlliance\tDay 1 Score\t…'} spellCheck={false} />
          </div>
          <div className="btnrow">
            <button className="btn btn--primary" onClick={read}>Read it</button>
          </div>
          {err && <div className="note note--bad">{err}</div>}
        </div>
      </div>

      {layout && (
        <div className="panel">
          <div className="note note--ok">
            Recognised {KIND_TEXT[layout.kind]} — {table.length - 1} rows,
            {' '}{layout.days.length || 1} score column{(layout.days.length || 1) === 1 ? '' : 's'}.
          </div>
          <div className="mapping" style={{ marginTop: 'var(--s4)' }}>
            {layout.kind !== 'flat' && (
              <>
                <span className="mapping__role">Day 1 was</span>
                <div className="row">
                  <input type="date" value={day1} onChange={e => setDay1(e.target.value)} style={{ width: 168 }} />
                  <span className="hint">Day 4 is three days later and the Final six.</span>
                </div>
              </>
            )}
            {layout.alliance < 0 && (
              <>
                <span className="mapping__role">Alliance</span>
                <select value={alliance} onChange={e => setAlliance(e.target.value)} style={{ width: 'auto', minWidth: 170 }}>
                  <option value="">{layout.kind === 'flat' ? 'from the roster' : 'choose…'}</option>
                  {MAIN_ALLIANCES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </>
            )}
            <span className="mapping__role">Existing</span>
            <label className="check">
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
              <span>Replace boards already saved for the same date and alliance</span>
            </label>
          </div>

          {needAlliance ? <div className="note note--warn" style={{ marginTop: 'var(--s4)' }}>Choose which alliance this tab belongs to.</div> : (
            <div className="stack" style={{ marginTop: 'var(--s4)' }}>
              <p className="hint">{boards.length} board{boards.length === 1 ? '' : 's'} · {totalRows} rows
                {unmatched ? ` · ${unmatched} names not on the roster` : ' · every name matched the roster'}</p>
              <div className="importmonths">
                {boards.map(b => {
                  const r = results && results.find(x => x.date === b.date && x.alliance === b.alliance && x.label === b.label);
                  return (
                    <div key={b.date + b.alliance + b.label} className="previewrow">
                      <AllianceChip a={b.alliance} />
                      <span><strong>{b.date}</strong> · {b.label || 'no day'} · top {Math.max(...b.rows.map(x => x.points)).toLocaleString()}</span>
                      <span className="previewrow__st">{b.rows.length} rows{b.unmatched ? ` · ${b.unmatched} new` : ''}</span>
                      <span className={'previewrow__st' + (r ? (r.ok ? ' is-ok' : ' is-bad') : '')}>{r ? (r.ok ? `saved ${r.saved} ✓` : r.error) : ''}</span>
                    </div>
                  );
                })}
              </div>
              <div className="btnrow">
                <FlashButton className="btn btn--primary" onClick={importAll} disabled={!boards.length}>
                  Import {boards.length} board{boards.length === 1 ? '' : 's'}
                </FlashButton>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
