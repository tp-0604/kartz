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

  let body = <p className="hint">Type a roster name and choose the player.</p>;
  if (data) {
    const { h } = data;
    if (!h.length) body = <div className="panel"><Empty title={`Nothing saved for “${data.search}”`} /></div>;
    else {
      const names = [...new Set(h.map(r => r.ingame))];
      const pts = h.map(r => r.points);
      const best = Math.max(...pts);
      const boards = [...new Set(h.map(r => r.board))];
      body = (
        <div className="stack">
          <Stats items={[
            [h.length, h.length === 1 ? 'board' : 'boards'], [best.toLocaleString(), 'best score'],
            [Math.round(pts.reduce((a, b) => a + b, 0) / pts.length).toLocaleString(), 'average'],
            [names.length, names.length === 1 ? 'name used' : 'names used'],
          ]} />
          <div className="row">
            <Sparkline values={pts} w={160} h={34} />
            {boards.map(b => <AllianceChip key={b} a={b} />)}
            {names.length > 1 && <span className="hint">seen as {names.map(n => '“' + n + '”').join(', ')}</span>}
          </div>
          <div className="tablewrap"><table>
            <thead><tr>
              <th>Date</th><th>Board</th><th>Day</th><th className="rank">Rank</th><th>Move</th>
              <th>Name in video</th><th className="num">Points</th><th>Change</th>
            </tr></thead>
            <tbody>{h.map((r, i) => {
              const prev = i > 0 ? h[i - 1] : null;
              return (
                <tr key={r.date + r.board}>
                  <td>{r.date}</td><td><AllianceChip a={r.board} /></td><td>{r.label || '—'}</td>
                  <td className="rank">{r.place}</td><td>{prev ? <RankDelta d={prev.place - r.place} /> : null}</td>
                  <td>{r.ingame}</td><ScoreCell v={r.points} max={best} />
                  <td>{prev ? <Delta d={r.points - prev.points} /> : <span className="delta flat">—</span>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </div>
      );
    }
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="field" style={{ minWidth: 280 }}>
          <label className="label">Player</label>
          <RosterSearch roster={roster} initial={who} autoFocus={false} commitOnBlur
                        onCommit={look} placeholder="roster name…" className="input" />
        </div>
      </div>
      {body}
    </div>
  );
}
