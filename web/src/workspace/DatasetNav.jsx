/**
 * What is open, and what else there is.
 *
 * The old app had a year, a month and a day to click through before it would show you anything.
 * The honest shape of this data is a list of boards in date order, so that is what this is —
 * with the ones you actually want at the top, because a board you saved this morning is the one
 * you are going to open.
 */
import { useMemo, useState } from 'react';
import { AllianceChip } from '../components/shared/ui.jsx';
import { fmtMonth } from '../utils/format.js';

export const VIEWS = [
  { id: 'month',    label: 'Month across days', hint: 'one row per player, a column per scoring day' },
  { id: 'player',   label: 'One player over time', hint: 'every board a player appears on' },
  { id: 'runs',     label: 'Extraction runs', hint: 'which recording put which rows where' },
  { id: 'activity', label: 'Activity', hint: 'what changed, and when' },
];

const n = v => (typeof v === 'number' ? v.toLocaleString() : v ?? '');

export default function DatasetNav({ datasets, current, onOpen, onNewBoard, onImport }) {
  const [q, setQ] = useState('');
  const [openMonths, setOpenMonths] = useState({});

  const boards = datasets ? datasets.boards : [];
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return boards;
    return boards.filter(b => (b.alliance + ' ' + b.date + ' ' + (b.label || '')).toLowerCase().includes(t));
  }, [boards, q]);

  // "Current" is the newest day anything was filmed on: one event's worth of boards, which is
  // what somebody opening this app in the middle of a scoring week is after.
  const newest = filtered.length ? filtered[0].date : null;
  const current_ = filtered.filter(b => b.date === newest);
  const rest = filtered.filter(b => b.date !== newest);
  const recent = rest.slice(0, 8);
  const older = rest.slice(8);

  const byMonth = useMemo(() => {
    const map = new Map();
    for (const b of older) {
      const m = b.date.slice(0, 7);
      if (!map.has(m)) map.set(m, []);
      map.get(m).push(b);
    }
    return [...map.entries()];
  }, [older]);

  const Item = ({ b }) => (
    <button type="button" className={'rail__item' + (current === b.key ? ' is-on' : '')}
            onClick={() => onOpen({ kind: 'dataset', key: b.key })} title={`${b.alliance} · ${b.date}`}>
      <AllianceChip a={b.alliance} />
      <span className="rail__main">
        <b>{b.date}</b>
        {b.label ? <span className="rail__sub">{b.label}</span> : null}
      </span>
      <span className="rail__n">{n(b.rows)}</span>
    </button>
  );

  return (
    <nav className="rail" aria-label="Datasets">
      <div className="rail__search">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a board…"
               spellCheck={false} aria-label="Find a board" />
      </div>

      <div className="rail__list">
        {datasets && (
          <>
            <div className="rail__group">Lists</div>
            <button type="button" className={'rail__item' + (current === 'roster' ? ' is-on' : '')}
                    onClick={() => onOpen({ kind: 'dataset', key: 'roster' })}>
              <span className="rail__main"><b>Roster</b>
                <span className="rail__sub">who is who</span></span>
              <span className="rail__n">{n(datasets.roster.rows)}</span>
            </button>
          </>
        )}

        {current_.length > 0 && (
          <>
            <div className="rail__group">Current<span>{newest}</span></div>
            {current_.map(b => <Item key={b.key} b={b} />)}
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="rail__group">Recent</div>
            {recent.map(b => <Item key={b.key} b={b} />)}
          </>
        )}

        {byMonth.length > 0 && (
          <>
            <div className="rail__group">Historical</div>
            {byMonth.map(([month, list]) => (
              <div key={month}>
                <button type="button" className="rail__item"
                        onClick={() => setOpenMonths(o => ({ ...o, [month]: !o[month] }))}
                        aria-expanded={!!openMonths[month]}>
                  <span className="rail__main"><b>{openMonths[month] ? '▾ ' : '▸ '}{fmtMonth(month)}</b></span>
                  <span className="rail__n">{list.length}</span>
                </button>
                {openMonths[month] && list.map(b => <Item key={b.key} b={b} />)}
              </div>
            ))}
          </>
        )}

        {!filtered.length && q && <div className="rail__group">No board matches “{q}”</div>}

        <div className="rail__group">Views</div>
        {VIEWS.map(v => (
          <button key={v.id} type="button" className={'rail__item' + (current === 'view:' + v.id ? ' is-on' : '')}
                  onClick={() => onOpen({ kind: 'view', id: v.id })} title={v.hint}>
            <span className="rail__main"><b>{v.label}</b></span>
          </button>
        ))}
      </div>

      <div className="rail__foot">
        <button className="btn btn--sm" onClick={onNewBoard} title="Create an empty board">+ Board</button>
        <button className="btn btn--sm" onClick={onImport} title="Bring in a spreadsheet">Import</button>
      </div>
    </nav>
  );
}
