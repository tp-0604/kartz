// What changed, to what, when. Traceability rather than version control: enough to answer "who
// emptied that column" without pretending to be a history anybody can roll back.
import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext.jsx';
import { activity as fetchActivity } from '../../services/api.js';
import { Empty } from '../../components/shared/ui.jsx';
import { fmtTime } from '../../utils/format.js';

const KIND = {
  edit: 'edited', insert: 'added', delete: 'deleted', import: 'imported',
  extract: 'from a recording', columns: 'columns', 'delete-board': 'deleted', summary: 'session', account: 'people',
};

export default function ActivityView({ onOpen }) {
  const { notify } = useApp();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    fetchActivity(120).then(j => setRows(j.activity || []))
      .catch(e => { setRows([]); notify('Could not read the activity: ' + e.message, 'bad'); });
  }, [notify]);

  if (!rows) return <div className="loading">Loading…</div>;

  return (
    <div className="viewpane stack">
      <div className="viewpane__head">
        <h2>Activity</h2>
        <span className="hint">The last {rows.length} things that changed the database.</span>
      </div>
      {!rows.length ? <Empty title="Nothing recorded yet">Edits, imports and extractions land here.</Empty> : (
        <div className="trail">
          {rows.map(a => (
            <div key={a.id} className="trail__item">
              <span className="trail__when">{fmtTime(a.at)}</span>
              <span className="trail__what">
                {/* A session entry is already written as a sentence about someone; the rest get their name. */}
                {a.kind === 'summary'
                  ? (a.ai_summary ? <span className="trail__ai">{a.ai_summary}</span> : a.summary)
                  : <>{a.actor_name && <b className="trail__who">{a.actor_name}</b>}{a.summary}</>}
                {a.dataset && (
                  <div className="trail__where">
                    {a.dataset === 'roster' ? 'Roster' : a.dataset.replace(/^board:kartz\|/, '')}
                    {a.dataset !== 'roster' && (
                      <button className="btn btn--sm btn--quiet" style={{ marginLeft: 6 }}
                              onClick={() => onOpen(a.dataset)}>open</button>
                    )}
                  </div>
                )}
              </span>
              <span className="pill pill--flat">{KIND[a.kind] || a.kind}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
