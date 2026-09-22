/**
 * What the recording said, as the table it is about to become.
 *
 * The dialog is wide enough for the columns the sheet actually has, so the review shows them:
 * rank, the roster name, the name the game drew, the alliance, the score, and one word about
 * whether this row is new. Clicking a row leaves it out; the count in the button follows.
 *
 * Three states are worth calling out and only three: matched, new to the roster, and already
 * on the sheet. Everything else is detail that belongs in the sheet, not in a review.
 */
import { useMemo } from 'react';

const STATE = {
  matched: ['ok', 'on the roster'],
  fresh: ['new', 'not on the roster'],
  dupe: ['dupe', 'already there'],
};

const num = v => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString());

export default function ReviewTable({ rows, dupes, dropped, meta, onMeta, where, onWhere, cursor,
                                      onToggle, onDropped, onSend, onCancel, warnings,
                                      canEdit, sheetName }) {
  const dupeSet = useMemo(() => new Set(dupes || []), [dupes]);
  const keeping = rows.filter((_, i) => !dropped.has(i)).length;
  const counts = useMemo(() => {
    let matched = 0, fresh = 0;
    rows.forEach((r, i) => {
      if (dupeSet.has(i)) return;
      if (r.search) matched++; else fresh++;
    });
    return { matched, fresh, dupes: dupeSet.size };
  }, [rows, dupeSet]);

  const dropDupes = () => {
    const next = new Set(dropped);
    dupeSet.forEach(i => next.add(i));
    onDropped(next);
  };
  const keepAll = () => onDropped(new Set());

  return (
    <>
      <div className="dlg__body">
        <aside className="dlg__rail">
          <p className="dlg__h">What was found</p>
          <dl className="facts">
            <div className="fact">
              <dt>Rows</dt>
              <dd>{keeping} of {rows.length}
                <small>
                  {counts.matched} matched{counts.fresh ? ` · ${counts.fresh} new` : ''}
                  {counts.dupes ? ` · ${counts.dupes} already there` : ''}
                </small>
              </dd>
            </div>
          </dl>

          {counts.dupes > 0 && (
            <div className="btnrow">
              <button type="button" className="btn btn--small" onClick={dropDupes}>Leave out the {counts.dupes} repeats</button>
              <button type="button" className="btn btn--small" onClick={keepAll}>Keep all</button>
            </div>
          )}

          <div className="field">
            <label htmlFor="rv-date">Date</label>
            <input id="rv-date" type="date" value={meta.date}
                   onChange={e => onMeta({ ...meta, date: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="rv-label">Label</label>
            <input id="rv-label" value={meta.label} placeholder="Day 1, Final…"
                   onChange={e => onMeta({ ...meta, label: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="rv-where">Where they go</label>
            <select id="rv-where" value={where} onChange={e => onWhere(e.target.value)}>
              <option value="end">at the end of the tab</option>
              <option value="cursor" disabled={!cursor || !cursor.row}>
                {cursor && cursor.row ? `above row ${cursor.row} — where the cursor is` : 'where the cursor is'}
              </option>
            </select>
            <small className="hint">
              {where === 'cursor' && cursor && cursor.row
                ? `Click another cell and this follows — the sheet is live while this is open.`
                : 'New rows are inserted, never written over, and take their formatting from the row above.'}
            </small>
          </div>

          {warnings}
        </aside>

        <section className="dlg__stage" style={{ padding: '12px 14px' }}>
          <div className="tbl">
            <div className="tbl__head">
              <span />
              <span>#</span>
              <span>Roster name</span>
              <span>In game</span>
              <span>Alliance</span>
              <span style={{ textAlign: 'right' }}>Score</span>
              <span>Status</span>
            </div>
            <div className="tbl__scroll">
              {rows.map((r, i) => {
                const state = dupeSet.has(i) ? 'dupe' : r.search ? 'matched' : 'fresh';
                const [cls, words] = STATE[state];
                const off = dropped.has(i);
                return (
                  <button type="button" key={i} className={'tbl__row' + (off ? ' is-off' : '')}
                          onClick={() => onToggle(i)}
                          title={off ? 'Put this row back' : 'Leave this row out'}>
                    <span className={'box' + (off ? '' : ' on')} aria-hidden="true">{off ? '' : '✓'}</span>
                    <span className="num">{r.place || '·'}</span>
                    <span className="nm"><b>{r.search || <em className="dim">—</em>}</b></span>
                    <span className="dim">{r.ingame}</span>
                    <span className="dim">{r.alliance}</span>
                    <span className="score">{num(r.points)}</span>
                    <span className={'tag tag--' + cls}>{words}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <footer className="dlg__foot">
        <span className="grow">
          {rows.length - keeping > 0
            ? `${rows.length - keeping} left out — click a row to put it back`
            : 'Click a row to leave it out'}
        </span>
        <button type="button" className="btn" onClick={onCancel}>Start again</button>
        <button type="button" className="btn btn--go" onClick={onSend} disabled={!keeping || !canEdit}>
          Send {keeping} to “{sheetName || 'the sheet'}”
        </button>
      </footer>
    </>
  );
}
