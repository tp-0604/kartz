// One month, scoring days across the top — the shape the workbook already uses, with growth
// as a subtraction done here rather than a column anybody has to keep in step.
import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { monthView } from '../../services/api.js';
import { AllianceChip, Delta, Empty, ScoreCell, Sparkline, Stats, useSort } from '../shared/ui.jsx';

export default function MonthView() {
  const { boards, notify } = useApp();
  const [month, setMonth] = useState(() => (boards[0] ? boards[0].date.slice(0, 7) : ''));
  const [alliance, setAlliance] = useState('');
  const [data, setData] = useState(null);
  const { apply, Head, sort } = useSort(null);
  const alls = [...new Set(boards.map(b => b.alliance))].sort();

  useEffect(() => { if (!month && boards[0]) setMonth(boards[0].date.slice(0, 7)); }, [boards, month]);
  useEffect(() => {
    if (!month) return;
    let live = true;
    monthView(month, alliance).then(j => live && setData(j)).catch(e => notify('✗ ' + e.message, 'bad'));
    return () => { live = false; };
  }, [month, alliance, notify]);

  const days = data ? [...new Set((data.rows || []).map(r => r.date))].sort() : [];
  let body = null;
  if (data && !days.length) body = <Empty title={`Nothing saved for ${month}`} />;
  else if (data) {
    const label = {}; for (const r of data.rows) label[r.date] = r.label || ('Day ' + r.date.slice(8));
    const players = new Map();
    for (const r of data.rows) {
      const key = r.search || r.ingame;
      if (!players.has(key)) players.set(key, { name: key, alliance: r.alliance, by: {} });
      players.get(key).by[r.date] = r.points;
      if (r.alliance) players.get(key).alliance = r.alliance;
    }
    const list = [...players.values()];
    const last = days[days.length - 1], first = days[0];
    const growthOf = p => (p.by[first] !== undefined && p.by[last] !== undefined && days.length > 1) ? p.by[last] - p.by[first] : null;
    const max = Math.max(...list.map(p => p.by[last] ?? 0), 0);
    const totals = days.map(d => data.rows.filter(r => r.date === d).reduce((n, r) => n + r.points, 0));
    const cols = [
      { h: 'Player', get: p => p.name }, { h: 'Alliance', get: p => p.alliance || '' },
      ...days.map(d => ({ h: label[d], get: p => p.by[d] ?? -1 })),
      ...(days.length > 1 ? [{ h: 'Trend' }, { h: 'Growth', get: p => growthOf(p) ?? -Infinity }] : []),
    ];
    const sorted = sort ? apply(list, cols) : list.slice().sort((a, b) => (b.by[last] ?? -1) - (a.by[last] ?? -1));
    body = (
      <>
        <Stats items={[
          [list.length, 'players'], [days.length, days.length === 1 ? 'scoring day' : 'scoring days'],
          [totals[totals.length - 1].toLocaleString(), 'total scored'], [alliance || 'all', 'alliance', true],
        ]} />
        <div className="tablewrap"><table className="histtbl">
          <Head cols={cols} />
          <tbody>{sorted.map(p => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td><AllianceChip a={p.alliance} /></td>
              {days.map(d => p.by[d] === undefined ? <td key={d} className="num flat">—</td> : <ScoreCell key={d} v={p.by[d]} max={max} />)}
              {days.length > 1 && <><td><Sparkline values={days.map(d => p.by[d])} /></td><td><Delta d={growthOf(p)} /></td></>}
            </tr>
          ))}</tbody>
        </table></div>
      </>
    );
  }

  return (
    <>
      <div className="viewbar">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <select value={alliance} onChange={e => setAlliance(e.target.value)}>
          <option value="">every alliance</option>
          {alls.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 12 }}>{month ? (body || <div className="note">loading…</div>) : <div className="note">Pick a month.</div>}</div>
    </>
  );
}
