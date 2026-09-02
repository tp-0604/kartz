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
      <div className="screenhead">
        <h1>Roster</h1>
        <p className="lede">Who is who: every player in the alliance's Google Sheet, plus the corrections made here.
          Fix a name the video draws differently, or a player's alliance, and the next extraction matches it.</p>
      </div>
      <section>
        <div className="viewbar">
          <input value={find} onChange={e => setFind(e.target.value)} spellCheck={false} placeholder="find a player…" />
          <select value={alli} onChange={e => setAlli(e.target.value)}>
            <option value="">every alliance</option>
            {alliances.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="ghost" onClick={() => setShowCols(s => !s)}>Columns</button>
          <FlashButton className="ghost" onClick={async () => { const c = await pullRoster(); return `${c.all.length} rows ✓`; }}>Pull from sheet</FlashButton>
          <button className="ghost" onClick={async () => {
            const name = window.prompt('Roster name for the new player:');
            if (!name || !name.trim()) return;
            await commit(name.trim(), { added: 1 }, `✓ ${name.trim()} added`);
          }}>Add player</button>
        </div>
        {showCols && (
          <div id="colpick" style={{ marginTop: 12 }}>
            {cols.map(c => (
              <label key={c.i} className="colopt">
                <input type="checkbox" checked={!hidden.has(c.i)} onChange={e => {
                  const h = new Set(hidden); if (e.target.checked) h.delete(c.i); else h.add(c.i); setHiddenPersist(h);
                }} /><span>{c.label}</span>
              </label>
            ))}
            <button className="ghost sm" onClick={() => setHiddenPersist(new Set())}>Show all</button>
          </div>
        )}

        {!roster.length ? (
          <div style={{ marginTop: 14 }}><Empty title="No roster yet">Press Pull from sheet. The sheet must be link-readable: Share → Anyone with the link → Viewer.</Empty></div>
        ) : (
          <>
            <div style={{ marginTop: 14 }}>
              <Stats items={[
                [roster.length, 'players'], [alliances.length, 'alliances'], [edited, 'corrected'], [added, 'added here'],
                [`${shown.length} / ${cols.length}`, 'columns', true],
              ]} />
            </div>
            {list.length !== roster.length && <div className="note">{list.length} of {roster.length} shown</div>}
            <div className="tablewrap">
              <table className="histtbl">
                <thead><tr>{shown.map(c => <th key={c.i}>{c.label}</th>)}<th></th><th></th></tr></thead>
                <tbody>
                  {list.map((r, ri) => (
                    <tr key={r.search + '|' + ri}>
                      {shown.map(c => {
                        if (c.i === 0) return <td key={c.i} style={{ fontWeight: 600 }}>{r.search}</td>;
                        if (c.i === 1) return (
                          <td key={c.i}>
                            <input className={'cellin ' + (r.src === 'sheet' ? 'asdrawn' : 'named')} defaultValue={r.ingame}
                                   onBlur={e => { const v = e.target.value.trim(); if (v !== r.ingame) commit(r.search, { ingame: v }, `✓ ${r.search} updated`); }} />
                          </td>);
                        if (c.i === 2) return (
                          <td key={c.i} className={allianceClass(r.alliance)}>
                            <select className="allipick" value={r.alliance || ''}
                                    onChange={e => commit(r.search, { alliance: e.target.value }, `✓ ${r.search} → ${e.target.value || '—'}`)}>
                              <option value="">—</option>
                              {opts.map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                          </td>);
                        const n = cols.indexOf(c);
                        const v = (r.cells && r.cells[n]) || '';
                        return <td key={c.i} className={/^-?[\d.,]+$/.test(v) ? 'num' : ''}>{v}</td>;
                      })}
                      <td>{r.src !== 'sheet' && <span className={'tag ' + (r.src === 'added' ? 'tag-new' : 'tag-edit')}>{r.src}</span>}</td>
                      <td style={{ textAlign: 'right' }}>
                        {r.src !== 'sheet' && (
                          <button className="ghost sm" onClick={async () => {
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
          </>
        )}
      </section>
    </>
  );
}
