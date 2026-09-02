// The roster: the alliance's Google Sheet, with this database's corrections on top.
//
// The sheet stays where players arrive and what everyone maintains. What lives here is a set
// of differences — which name the video actually draws, which alliance somebody really
// belongs to — so "Pull from sheet" brings in new players without undoing a single correction.
import { useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { MAIN_ALLIANCES } from '../../extractor/config.js';
import { store } from '../../utils/storage.js';
import { allianceClass, Empty, FlashButton, Stats } from '../shared/ui.jsx';

export default function RosterScreen() {
  const { roster, rosterCache, pullRoster, putRosterEdit, revertRosterEdit, notify } = useApp();
  const [find, setFind] = useState('');
  const [alli, setAlli] = useState('');
  const [showCols, setShowCols] = useState(false);
  const [hidden, setHidden] = useState(() => new Set(store.get('rosterHidden') || []));

  const cols = (rosterCache && rosterCache.cols && rosterCache.cols.length) ? rosterCache.cols
    : [{ label: 'Player', i: 0 }, { label: 'Name in video', i: 1 }, { label: 'Alliance', i: 2 }];
  const shown = cols.filter(c => !hidden.has(c.i));
  const setHiddenPersist = h => { setHidden(h); store.set('rosterHidden', [...h]); };

  const alliances = [...new Set(roster.map(r => r.alliance).filter(Boolean))].sort();
  const f = find.trim().toLowerCase();
  const list = roster.filter(r => (!alli || r.alliance === alli)
    && (!f || r.search.toLowerCase().includes(f) || (r.ingame || '').toLowerCase().includes(f)));
  const edited = roster.filter(r => r.src === 'edited').length;
  const added = roster.filter(r => r.src === 'added').length;
  const opts = [...MAIN_ALLIANCES, ...alliances.filter(a => !MAIN_ALLIANCES.includes(a))];

  const commit = async (search, patch, said) => {
    try { await putRosterEdit(search, patch); notify(said); }
    catch (e) { notify('✗ ' + e.message, 'bad'); }
  };

  return (
    <>
      <div className="pagehead">
        <div className="pagehead__text">
          <h1>Roster</h1>
          <p>Every player in the alliance's Google Sheet, plus the corrections made here. Fix a name the video
            draws differently, or a player's alliance, and the next extraction matches it.</p>
        </div>
        <div className="pagehead__actions">
          <button className="btn" onClick={() => setShowCols(s => !s)}>Columns {shown.length}/{cols.length}</button>
          <button className="btn" onClick={async () => {
            const name = window.prompt('Roster name for the new player:');
            if (!name || !name.trim()) return;
            await commit(name.trim(), { added: 1 }, `✓ ${name.trim()} added`);
          }}>Add player</button>
          <FlashButton className="btn btn--primary"
            onClick={async () => { const c = await pullRoster(); return `${c.all.length} ✓`; }}>Pull from sheet</FlashButton>
        </div>
      </div>

      {!roster.length ? (
        <div className="panel">
          <Empty title="No roster yet">
            Press Pull from sheet. The sheet must be link-readable: Share → Anyone with the link → Viewer.
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <Stats items={[
            [roster.length, 'players'], [alliances.length, 'alliances'],
            [edited, 'corrected'], [added, 'added here'],
          ]} />

          <div className="toolbar">
            <div className="field" style={{ minWidth: 240 }}>
              <label className="label" htmlFor="rfind">Find</label>
              <input id="rfind" value={find} onChange={e => setFind(e.target.value)} spellCheck={false} placeholder="a player…" />
            </div>
            <div className="field">
              <label className="label" htmlFor="ralli">Alliance</label>
              <select id="ralli" value={alli} onChange={e => setAlli(e.target.value)}>
                <option value="">every alliance</option>
                {alliances.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="toolbar__spacer" />
            {list.length !== roster.length && <span className="hint">{list.length} of {roster.length} shown</span>}
          </div>

          {showCols && (
            <div className="colpick">
              {cols.map(c => (
                <label key={c.i} className="check">
                  <input type="checkbox" checked={!hidden.has(c.i)} onChange={e => {
                    const h = new Set(hidden); if (e.target.checked) h.delete(c.i); else h.add(c.i); setHiddenPersist(h);
                  }} /><span>{c.label}</span>
                </label>
              ))}
              <div className="toolbar__spacer" />
              <button className="btn btn--sm btn--quiet" onClick={() => setHiddenPersist(new Set())}>Show all</button>
            </div>
          )}

          <div className="tablewrap">
            <table>
              <thead><tr>{shown.map(c => <th key={c.i} title={c.label}>{c.label}</th>)}<th /><th /></tr></thead>
              <tbody>
                {list.map((r, ri) => (
                  <tr key={r.search + '|' + ri}>
                    {shown.map(c => {
                      if (c.i === 0) return <td key={c.i} className="name">{r.search}</td>;
                      if (c.i === 1) return (
                        <td key={c.i}>
                          <input className="cellin" defaultValue={r.ingame}
                                 onBlur={e => { const v = e.target.value.trim(); if (v !== r.ingame) commit(r.search, { ingame: v }, `✓ ${r.search} updated`); }} />
                        </td>);
                      if (c.i === 2) return (
                        <td key={c.i} className={allianceClass(r.alliance)}>
                          <select className="cellsel" value={r.alliance || ''}
                                  onChange={e => commit(r.search, { alliance: e.target.value }, `✓ ${r.search} → ${e.target.value || '—'}`)}>
                            <option value="">—</option>
                            {opts.map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </td>);
                      const n = cols.indexOf(c);
                      const v = (r.cells && r.cells[n]) || '';
                      return <td key={c.i} className={/^-?[\d.,]+$/.test(v) ? 'num' : ''}>{v}</td>;
                    })}
                    <td>{r.src !== 'sheet' && <span className={'pill ' + (r.src === 'added' ? 'pill--flat' : 'pill--warn')}>{r.src}</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.src !== 'sheet' && (
                        <button className="btn btn--sm btn--quiet" onClick={async () => {
                          try { await revertRosterEdit(r.search); notify(`✓ ${r.search} back to the sheet`); }
                          catch (e) { notify('✗ ' + e.message, 'bad'); }
                        }}>Revert</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
