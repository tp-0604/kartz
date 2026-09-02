// The rows a run produced, and every way to settle one without typing: tick it, pick a
// name, throw it out, bring it back. Same rules as the old render(), row for row.
import { MAIN_ALLIANCES } from '../../extractor/config.js';
import { fold } from '../../extractor/matching.js';
import { missingRanks } from '../../extractor/run.js';
import RosterSearch from './RosterSearch.jsx';

// The sheet wants the name as it is written in the game — the roster's column B — not the
// searchable name in column A, so a chosen name is translated back here.
export function makeOutName(roster) {
  return r => {
    if (r.match) return r.match.ingame || r.match.search;
    if (r.pick) {
      const hit = roster.find(x => (x.ingame || x.search) === r.pick)
               || roster.find(x => x.search === r.pick)
               || roster.find(x => fold(x.search) === fold(r.pick) && fold(r.pick));
      return hit ? (hit.ingame || hit.search) : r.pick;      // genuinely new player
    }
    return r.name || r.plain;
  };
}

export const keptRows = rows => rows.filter(r => !r.dropped && !r.skipped && r.rank > 0);

export default function ReviewTable({ rows, setRows, roster, allianceAll, setAllianceAll }) {
  const outName = makeOutName(roster);
  const update = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)));

  const dropped = rows.filter(r => r.skipped).length;
  const need = rows.filter(r => !r.match && !r.skipped && !r.confirmed && !r.dropped && !r.pick).length;
  const { top, holes } = missingRanks(rows);
  const holeText = holes.length > 12 ? holes.slice(0, 12).join(', ') + ` and ${holes.length - 12} more` : holes.join(', ');

  const chooseAll = v => {
    setAllianceAll(v);
    setRows(rs => rs.map(r => {
      if (v) return { ...r, alliancePick: v };
      const { alliancePick: _drop, ...rest } = r; return rest;
    }));
  };

  return (
    <>
      <div className={need || holes.length ? 'warnbox' : 'okbox'}>
        {rows.length} players · {rows.length - need - dropped} matched to the roster
        {dropped ? ` · ${dropped} excluded` : ''}
        {need ? <> · <strong>{need} to confirm below</strong></> : null}
      </div>
      {holes.length > 0 && (
        <div className="warnbox">
          The game showed ranks up to {top}, but {holes.length === 1
            ? <>rank <strong>{holeText}</strong> was never captured, so that player is missing from the rows below. </>
            : <>{holes.length} ranks were never captured — <strong>{holeText}</strong> — so those players are missing from the rows below. </>}
          Everyone else keeps the rank the game gave them. Record that stretch again more slowly if you want the gap filled.
        </div>
      )}
      <div className="tablewrap">
        <table id="tbl">
          <thead><tr>
            <th>Rank</th><th>Name in video</th><th>Game Name</th>
            <th>Alliance<br />
              <select className="allipick" value={allianceAll} onChange={e => chooseAll(e.target.value)} title="one alliance for the whole recording">
                <option value="">as found</option>
                {MAIN_ALLIANCES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </th>
            <th>Kartz Points</th><th></th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const settled = !r.editing && !r.dropped;
              const green = r.match || r.confirmed || r.skipped;
              const shown = r.skipped && !r.pick ? (r.skipped.ingame || r.skipped.search) : outName(r);
              const alli = allianceAll || (r.alliancePick !== undefined ? r.alliancePick
                         : r.match ? r.match.alliance : r.skipped ? r.skipped.alliance : '');
              return (
                <tr key={i} className={(green || r.pick ? 'ok' : 'new') + (r.dropped ? ' drop' : '')}>
                  <td>{r.skipped ? (r.seenRank || '—') : r.rank}</td>
                  <td>{r.name}</td>
                  <td>
                    {settled ? (
                      <>
                        <span className={green ? 'named' : 'asdrawn'}>{shown}</span>
                        <button className="pencil" title="change this name" onClick={() => update(i, { editing: true })}>✎</button>
                        {!green && (
                          <button className="ghost tickok" title="this name is right as it is"
                                  style={{ width: 'auto', padding: '4px 9px', marginLeft: 6, minHeight: 0 }}
                                  onClick={() => update(i, { confirmed: true })}>✓</button>
                        )}
                      </>
                    ) : (
                      <RosterSearch roster={roster} initial={r.pick || (r.editing ? shown : '')}
                        commitOnBlur={!r.editing}
                        onCommit={v => update(i, row => {
                          const next = { ...row, pick: v };
                          if (row.editing) {
                            next.match = null; next.editing = false; next.confirmed = true;
                            if (row.skipped) { next.skipped = null; if (!(row.rank > 0)) next.rank = row.seenRank || null; }
                          }
                          return next;
                        })}
                        onCancel={() => update(i, { editing: false })} />
                    )}
                  </td>
                  <td>{alli ? alli : <span className="note">—</span>}</td>
                  <td>{r.points}</td>
                  <td>{r.skipped ? <span className="pill p-new">excluded</span>
                     : r.match ? <span className="pill p-ok">{r.near1 ? '1 char' : 'exact'}</span>
                     : r.confirmed ? <span className="pill p-ok">confirmed</span>
                     : <span className="pill p-new">confirm</span>}</td>
                  <td>
                    <button className="ghost rowdrop" title={r.dropped ? 'bring this row back' : 'not a real row'}
                            style={{ width: 'auto', padding: '4px 9px', minHeight: 0 }}
                            onClick={() => update(i, row => ({ dropped: !row.dropped, editing: false }))}>
                      {r.dropped ? '↺' : '✕'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
