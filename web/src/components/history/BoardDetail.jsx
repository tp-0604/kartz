// One board, and a quick place to correct a row without opening the sheet. Each cell commits
// when you leave it, and a corrected row is marked so a re-extraction cannot undo it.
import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { deleteBoard, deleteRow, loadBoard, patchRow } from '../../services/api.js';
import { MAIN_ALLIANCES } from '../../extractor/config.js';
import { AllianceChip, Delta, Stats, useSort, allianceClass } from '../shared/ui.jsx';

export default function BoardDetail({ id, onBack, onOpenInSheet }) {
  const { boards, refreshBoards, notify } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const { apply, Head } = useSort(null);

  const load = async () => {
    setErr('');
    try {
      const j = await loadBoard(id);
      const b = j.board;
      const prev = boards.filter(x => x.alliance === b.alliance && x.date < b.date).sort((x, y) => y.date.localeCompare(x.date))[0];
      const p = prev ? await loadBoard(prev.id) : null;
      setData({ ...j, prev: p });
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [id]);

  if (err) return <div className="note note--bad">{err} <button className="btn btn--sm" onClick={onBack}>Back</button></div>;
  if (!data) return <div className="loading">Loading…</div>;
  const { board: b, rows: rw, prev } = data;
  const max = Math.max(...rw.map(r => r.points), 0);
  const before = new Map();
  if (prev) for (const r of prev.rows) if (r.search) before.set(r.search, r);
  const matched = rw.filter(r => r.search).length;
  const edited = rw.filter(r => r.edited).length;

  const commit = async (place, field, value) => {
    try { await patchRow(id, place, { [field]: value }); await load(); refreshBoards().catch(() => {}); }
    catch (e) { notify('✗ ' + e.message, 'bad'); }
  };
  const removeRow = async r => {
    if (!window.confirm(`Remove rank ${r.place} (${r.ingame}) from this board?`)) return;
    try { await deleteRow(id, r.place); await load(); refreshBoards().catch(() => {}); }
    catch (e) { notify('✗ ' + e.message, 'bad'); }
  };
  const removeBoard = async () => {
    if (!window.confirm(`Delete the ${b.alliance} board from ${b.date}, and its ${rw.length} rows?\n\nThis cannot be undone.`)) return;
    try { const j = await deleteBoard(id); notify(`deleted ${j.rows} rows`); await refreshBoards(); onBack(); }
    catch (e) { notify('✗ ' + e.message, 'bad'); }
  };

  const cols = [
    { h: 'Rank', get: r => r.place }, { h: 'Player', get: r => r.search || '' }, { h: 'Name in video', get: r => r.ingame },
    { h: 'Alliance', get: r => r.alliance || '' }, { h: 'Points', num: true, get: r => r.points },
    { h: 'Change', get: r => { const p = r.search && before.get(r.search); return p ? r.points - p.points : -Infinity; } },
    { h: '' }, { h: '' },
  ];
  const list = apply(rw, cols);
  const opts = [...MAIN_ALLIANCES, ...new Set(rw.map(r => r.alliance).filter(a => a && !MAIN_ALLIANCES.includes(a)))];

  return (
    <div className="stack">
      <div className="toolbar toolbar--tight">
        <button className="btn btn--sm btn--quiet" onClick={onBack}>← All boards</button>
        <AllianceChip a={b.alliance} />
        <span className="hint"><strong>{b.date}</strong>{b.label ? ' · ' + b.label : ''}
          {prev ? ` · compared with ${prev.board.date}` : ' · no earlier board to compare'}</span>
        <div className="toolbar__spacer" />
        <button className="btn btn--sm btn--primary" onClick={onOpenInSheet}>Open in sheet</button>
        <button className="btn btn--sm btn--danger" onClick={removeBoard}>Delete board</button>
      </div>

      <Stats items={[
        [rw.length, 'players'], [max.toLocaleString(), 'top score'],
        [Math.round(rw.reduce((n, r) => n + r.points, 0) / (rw.length || 1)).toLocaleString(), 'average'],
        [`${matched}/${rw.length}`, 'named'], [edited, 'corrected'],
        [data.sheet ? 'yes' : 'no', 'sheet saved', true],
      ]} />
      <p className="hint">Edit a cell and leave it to save the correction. For anything bigger, open the board in the sheet.</p>

      <div className="tablewrap"><table>
        <Head cols={cols} />
        <tbody>{list.map(r => {
          const p = r.search ? before.get(r.search) : null;
          return (
            <tr key={r.place}>
              <td className="rank">{r.place}</td>
              <td><input className="cellin" defaultValue={r.search || ''}
                         onBlur={e => { if (e.target.value.trim() !== (r.search || '')) commit(r.place, 'search', e.target.value.trim()); }} /></td>
              <td><input className="cellin" defaultValue={r.ingame}
                         onBlur={e => { if (e.target.value.trim() !== r.ingame) commit(r.place, 'ingame', e.target.value.trim()); }} /></td>
              <td className={allianceClass(r.alliance)}>
                <select className="cellsel" value={r.alliance || ''} onChange={e => commit(r.place, 'alliance', e.target.value)}>
                  <option value="">—</option>{opts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </td>
              <td className="num"><input className="cellin num" defaultValue={r.points}
                         onBlur={e => { const v = e.target.value.replace(/[^\d-]/g, ''); if (v !== String(r.points)) commit(r.place, 'points', v); }} /></td>
              <td>{p ? <Delta d={r.points - p.points} /> : <span className="delta flat">—</span>}</td>
              <td>{r.edited ? <span className="pill pill--warn">edited</span> : !r.search ? <span className="pill pill--flat">new</span> : null}</td>
              <td><button className="iconbtn iconbtn--danger" title="remove this row" onClick={() => removeRow(r)}>✕</button></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}
