// Where a board's rows came from. One row per recording processed, so "who put these 84 names
// here, and when" is a question with an answer rather than a memory.
import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { listRuns } from '../../services/api.js';
import { AllianceChip, Empty, Stats } from '../../components/shared/ui.jsx';
import { fmtTime } from '../../utils/format.js';

export default function RunsView({ onOpen }) {
  const { notify } = useApp();
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    listRuns().then(j => setRuns(j.runs || []))
      .catch(e => { setRuns([]); notify('Could not read the runs: ' + e.message, 'bad'); });
  }, [notify]);

  if (!runs) return <div className="loading">Loading…</div>;

  return (
    <div className="viewpane stack">
      <div className="viewpane__head">
        <h2>Extraction runs</h2>
        <span className="hint">Every recording this app has read, and what it put into the database.</span>
      </div>

      {!runs.length ? (
        <Empty title="No runs recorded yet">
          A run is written whenever extracted names are added to the data. Boards imported from
          the old workbook have none, because nothing extracted them.
        </Empty>
      ) : (
        <>
          <Stats items={[
            [runs.length, runs.length === 1 ? 'run' : 'runs'],
            [runs.reduce((n, r) => n + r.added, 0).toLocaleString(), 'rows added'],
            [runs.reduce((n, r) => n + r.duplicates, 0).toLocaleString(), 'already there'],
            [fmtTime(runs[0].created_at), 'most recent', true],
          ]} />
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr>
                <th>When</th><th>Board</th><th>Recording</th>
                <th className="num">Found</th><th className="num">Added</th><th className="num">Already there</th>
                <th className="num">Frames</th><th />
              </tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtTime(r.created_at)}</td>
                    <td className="nowrap"><AllianceChip a={r.alliance} /> {r.date}{r.label ? ' · ' + r.label : ''}</td>
                    <td className="truncate mono" style={{ maxWidth: 220 }} title={r.video || ''}>
                      {r.video || <span className="muted">—</span>}
                    </td>
                    <td className="num">{r.found}</td>
                    <td className="num">{r.added}</td>
                    <td className="num">{r.duplicates || <span className="muted">—</span>}</td>
                    <td className="num">{r.frames || <span className="muted">—</span>}</td>
                    <td>
                      {r.board_id && (
                        <button className="btn btn--sm" onClick={() => onOpen('board:' + r.board_id)}>Open</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
