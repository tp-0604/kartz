// One player, every alliance, every month — the question a spreadsheet tab cannot answer.
import { useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { playerView } from '../../services/api.js';
import RosterSearch from '../extract/RosterSearch.jsx';
import { AllianceChip, Delta, Empty, RankDelta, ScoreCell, Sparkline, Stats } from '../shared/ui.jsx';

export default function PlayerView() {
  const { roster, notify } = useApp();
  const [who, setWho] = useState('');
  const [data, setData] = useState(null);

  const look = async name => {
    // the search box hands back the in-game name; history is keyed on the roster name
    const hit = roster.find(r => (r.ingame || r.search) === name) || roster.find(r => r.search === name);
    const search = hit ? hit.search : name;
    setWho(search);
    if (!search) { setData(null); return; }
    try { setData({ search, h: (await playerView(search)).history || [] }); }
    catch (e) { notify('✗ ' + e.message, 'bad'); }
  };

  let body = null;
  if (data) {
    const { h } = data;
    if (!h.length) body = <Empty title={`Nothing saved for "${data.search}"`} />;
    else {
      const names = [...new Set(h.map(r => r.ingame))];
      const pts = h.map(r => r.points);
      const best = Math.max(...pts);
      const boards = [...new Set(h.map(r => r.board))];
      body = (
        <>
          <Stats items={[
            [h.length, h.length === 1 ? 'board' : 'boards'], [best.toLocaleString(), 'best score'],
            [Math.round(pts.reduce((a, b) => a + b, 0) / pts.length).toLocaleString(), 'average'],
            [names.length, names.length === 1 ? 'name used' : 'names used'],
          ]} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <Sparkline values={pts} w={150} h={32} />
            <span className="bsub">{boards.map(b => <AllianceChip key={b} a={b} />)}{names.length > 1 ? ` · seen as ${names.map(n => '“' + n + '”').join(', ')}` : ''}</span>
          </div>
          <div className="tablewrap"><table className="histtbl">
            <thead><tr><th>Date</th><th>Board</th><th>Label</th><th>Rank</th><th>Move</th><th>Name in video</th><th>Points</th><th>Change</th></tr></thead>
            <tbody>{h.map((r, i) => {
              const prev = i > 0 ? h[i - 1] : null;
              return (
                <tr key={r.date + r.board}>
                  <td>{r.date}</td><td><AllianceChip a={r.board} /></td><td>{r.label || '—'}</td>
                  <td className="rank">{r.place}</td><td>{prev ? <RankDelta d={prev.place - r.place} /> : null}</td>
                  <td>{r.ingame}</td><ScoreCell v={r.points} max={best} />
                  <td>{prev ? <Delta d={r.points - prev.points} /> : <span className="flat">—</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </>
      );
    }
  }

  return (
    <>
      <div className="viewbar">
        <div style={{ minWidth: 260 }}>
          <RosterSearch roster={roster} initial={who} autoFocus={false} commitOnBlur onCommit={look} placeholder="roster name…" className="" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>{body || <div className="note">Type a roster name and choose the player.</div>}</div>
    </>
  );
}
