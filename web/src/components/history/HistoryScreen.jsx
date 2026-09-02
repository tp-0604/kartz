// Every board ever saved. Four ways to look at them, a level below the main tabs because they
// choose what to look at rather than what to do: by month and day, one month across its
// scoring days, one player across every month, and the import that backloads the past.
import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { DAYS } from '../../extractor/config.js';
import { allRows as fetchAll, patchBoard } from '../../services/api.js';
import { monthName } from '../../utils/format.js';
import { AllianceChip, Empty, ScoreCell, Delta, Stats, useSort, allianceClass } from '../shared/ui.jsx';
import BoardDetail from './BoardDetail.jsx';
import MonthView from './MonthView.jsx';
import PlayerView from './PlayerView.jsx';
import ImportScreen from './ImportScreen.jsx';

const VIEWS = [['boards', 'Boards'], ['month', 'Month'], ['player', 'Player'], ['import', 'Import']];

export default function HistoryScreen({ active }) {
  const { boards, boardsLoaded, refreshBoards, notify, stage } = useApp();
  const [view, setView] = useState('boards');
  const [openId, setOpenId] = useState(null);
  const [drill, setDrill] = useState({ year: null, month: null, day: null });
  const [all, setAll] = useState(null);

  useEffect(() => { if (active) refreshBoards().catch(e => notify('✗ ' + e.message, 'bad')); }, [active]);
  useEffect(() => { setAll(null); }, [boards]);

  // ---- the drill: year, then month, then which of the three recordings -------------------
  const years = [...new Set(boards.map(b => b.date.slice(0, 4)))].sort().reverse();
  const year = years.includes(drill.year) ? drill.year : years[0] || null;
  const months = [...new Set(boards.filter(b => b.date.startsWith(year || ' ')).map(b => b.date.slice(0, 7)))].sort().reverse();
  const month = months.includes(drill.month) ? drill.month : months[0] || null;
  const inMonth = boards.filter(b => b.date.startsWith(month || ' '));
  const unlabelled = inMonth.filter(b => !b.label).length;
  const days = [...DAYS.map(d => [d, inMonth.filter(b => b.label === d).length]),
                ...(unlabelled ? [['Unlabelled', unlabelled]] : []), ['Combined', inMonth.length]];
  let day = drill.day;
  if (!days.some(([d]) => d === day)) {
    const first = days.find(([d, n]) => n > 0 && d !== 'Combined');
    day = (first || days[days.length - 1])[0];
  }

  const chip = (val, text, on, count, onClick) => (
    <button key={val} type="button" className={'chipbtn' + (on ? ' on' : '') + (count === 0 ? ' empty' : '')} onClick={onClick}>
      {text}{count === undefined ? null : <span className="n">{count}</span>}
    </button>
  );

  const openBoard = id => { setOpenId(id); };
  const openInSheet = id => stage({ kind: 'board', id });

  return (
    <>
      <div className="screenhead">
        <h1>History</h1>
        <p className="lede">Every board saved, from any device. Open one to correct a row, or send it to the sheet to work on it properly.</p>
      </div>
      <section>
        <div className="tabs">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={'tab' + (view === id && !(id === 'boards' && openId) ? ' on' : '')}
                    onClick={() => { setView(id); setOpenId(null); }}>{label}</button>
          ))}
          {openId && <span className="tab on">Board</span>}
        </div>

        {view === 'boards' && openId && (
          <BoardDetail id={openId} onBack={() => setOpenId(null)} onOpenInSheet={() => openInSheet(openId)} />
        )}

        {view === 'boards' && !openId && (
          <>
            {!boards.length ? (
              boardsLoaded
                ? <Empty title="Nothing saved yet">Extract a recording and save it, or import past months from the tracking sheet.</Empty>
                : <div className="note">loading…</div>
            ) : (
              <>
                <div id="drill">
                  <div className="drillrow"><span className="drilllab">Year</span><div className="chiprow">
                    {years.map(y => chip(y, y, y === year, boards.filter(b => b.date.startsWith(y)).length, () => setDrill({ year: y, month: null, day })))}
                  </div></div>
                  <div className="drillrow"><span className="drilllab">Month</span><div className="chiprow">
                    {months.map(m => chip(m, monthName(m), m === month, boards.filter(b => b.date.startsWith(m)).length, () => setDrill({ year, month: m, day })))}
                  </div></div>
                  <div className="drillrow"><span className="drilllab">Day</span><div className="chiprow">
                    {days.map(([d, n]) => chip(d, d, d === day, n, () => setDrill({ year, month, day: d })))}
                  </div></div>
                </div>
                {day === 'Combined'
                  ? <Combined month={month} year={year} all={all} setAll={setAll} />
                  : <DayBoards boards={boards} month={month} day={day} onOpen={openBoard} onOpenInSheet={openInSheet} />}
              </>
            )}
          </>
        )}

        {view === 'month' && <MonthView />}
        {view === 'player' && <PlayerView />}
      </section>
      {view === 'import' && <ImportScreen />}
    </>
  );
}

// The boards of one scoring day, as cards.
function DayBoards({ boards, month, day, onOpen, onOpenInSheet }) {
  const { refreshBoards, notify } = useApp();
  const want = day === 'Unlabelled' ? null : day;
  const list = boards.filter(b => b.date.startsWith(month) && (b.label || null) === want);
  if (!list.length) return <Empty title={`No ${day} board yet`}>for {monthName(month)}</Empty>;
  const setDay = async (id, label) => {
    try { await patchBoard(id, { label }); notify(`✓ set to ${label}`); refreshBoards().catch(() => {}); }
    catch (e) { notify('✗ ' + e.message, 'bad'); }
  };
  return (
    <>
      <Stats items={[
        [list.length, list.length === 1 ? 'board' : 'boards'],
        [list.reduce((a, b) => a + b.players, 0), 'players'],
        [Math.max(...list.map(b => b.best || 0)).toLocaleString(), 'top score'],
        [list.map(b => b.date).sort()[0], 'filmed', true],
      ]} />
      <div className="boardlist">
        {list.map(b => (
          <div key={b.id} className="boardcard" onClick={() => onOpen(b.id)}>
            <div className="bmeta">
              <AllianceChip a={b.alliance} />
              <span className="bdate">{b.date}</span>
              {b.label ? null : <span className="tag tag-edit">no day set</span>}
              {b.has_sheet ? <span className="tag tag-new" title="a formatted sheet is saved with this board">sheet</span> : null}
              <span className="bsub">{b.players} players · top {(b.best ?? 0).toLocaleString()}</span>
            </div>
            <div className="cardacts" onClick={e => e.stopPropagation()}>
              {!b.label && (
                <select className="allipick" defaultValue="" onChange={e => e.target.value && setDay(b.id, e.target.value)}>
                  <option value="">set day…</option>
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <button className="ghost" onClick={() => onOpen(b.id)}>View</button>
              <button onClick={() => onOpenInSheet(b.id)}>Open in sheet</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// One row per player, one column per scoring day. Four separate boards is how the recordings
// arrive; one list is the question people actually ask.
function Combined({ month, year, all, setAll }) {
  const { notify } = useApp();
  const [err, setErr] = useState('');
  useEffect(() => {
    if (all) return;
    fetchAll().then(j => setAll(j.rows || [])).catch(e => { setErr(e.message); notify('✗ ' + e.message, 'bad'); });
  }, [all, setAll, notify]);
  const { apply, Head } = useSort(null);
  if (err) return <div className="note">✗ {err}</div>;
  if (!all) return <div className="note">loading…</div>;
  const rowsIn = all.filter(r => (r.date || '').startsWith(month));
  if (!rowsIn.length) return <Empty title={`Nothing saved for ${monthName(month)}`} />;

  const byPlayer = new Map();
  for (const r of rowsIn) {
    const key = r.search || r.ingame;
    if (!byPlayer.has(key)) byPlayer.set(key, { name: key, named: !!r.search, alliance: r.alliance || null, days: {} });
    const p = byPlayer.get(key);
    if (!p.alliance && r.alliance) p.alliance = r.alliance;
    const slot = r.label || 'Unlabelled';
    if (!(slot in p.days) || r.points > p.days[slot]) p.days[slot] = r.points;
  }
  const present = DAYS.filter(d => rowsIn.some(r => r.label === d));
  const cols = rowsIn.some(r => !r.label) ? [...present, 'Unlabelled'] : present;
  if (!cols.length) cols.push('Unlabelled');
  const list = [...byPlayer.values()].map(p => {
    const vals = cols.map(d => p.days[d]);
    const seen = vals.filter(v => typeof v === 'number');
    return { ...p, total: seen.reduce((a, b) => a + b, 0), best: seen.length ? Math.max(...seen) : 0,
             move: seen.length > 1 ? seen[seen.length - 1] - seen[0] : null };
  });
  const columns = [
    { h: '#' }, { h: 'Player', get: p => p.name }, { h: 'Alliance', get: p => p.alliance || '' },
    ...cols.map(d => ({ h: d, get: p => p.days[d] ?? -Infinity })),
    { h: 'Total', get: p => p.total }, { h: 'Move', get: p => p.move ?? -Infinity },
  ];
  const sorted = apply(list.slice().sort((a, b) => b.total - a.total), columns);
  const max = Math.max(1, ...list.map(p => p.best));
  return (
    <>
      <Stats items={[
        [list.length, 'players'], [cols.length, cols.length === 1 ? 'day' : 'days'],
        [new Set(list.map(p => p.alliance).filter(Boolean)).size, 'alliances'],
        [list.reduce((a, p) => a + p.total, 0).toLocaleString(), 'points'],
        [`${monthName(month)} ${year}`, 'month', true],
      ]} />
      <div className="tablewrap"><table id="histTbl">
        <Head cols={columns} />
        <tbody>{sorted.map((p, n) => (
          <tr key={p.name}>
            <td className="rank">{n + 1}</td>
            <td style={{ fontWeight: 600 }} className={p.named ? '' : 'asdrawn'}>{p.name} {p.named ? null : <span className="tag tag-new">not on roster</span>}</td>
            <td className={allianceClass(p.alliance)} style={{ fontWeight: 600 }}>{p.alliance || ''}</td>
            {cols.map(d => typeof p.days[d] === 'number' ? <ScoreCell key={d} v={p.days[d]} max={max} /> : <td key={d} className="num"><span className="flat">—</span></td>)}
            <td className="num" style={{ fontWeight: 700 }}>{p.total.toLocaleString()}</td>
            <td>{p.move === null ? <span className="flat">—</span> : <Delta d={p.move} />}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
