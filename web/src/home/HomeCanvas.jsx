/**
 * The canvas: everything saved, laid out the way the event actually happens.
 *
 * A month is a grid — alliances down the side, the days boards were filmed across the top — so
 * what has been captured and what has not is visible before anything is opened. A board opens as
 * a sheet over this, and putting the sheet away comes back here.
 *
 * The columns are the real dates rather than three fixed "Day 1 / Day 4 / Final" slots: some
 * months hold two events, and fixed slots would stack their boards on top of one another.
 *
 * A recording can be dropped anywhere on it, because that is the thing done here most.
 */
import { Fragment, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { MAIN_ALLIANCES } from '../extractor/config.js';
import { fmtMonth } from '../utils/format.js';
import { VIEWS } from '../app/views.js';

const dayOf = ymd => new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const hasFiles = e => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
const n = v => (typeof v === 'number' ? v.toLocaleString() : '—');
const hue = a => {
  const i = MAIN_ALLIANCES.indexOf(a);
  return i < 0 ? 'var(--aX)' : `var(--a${i})`;
};

export default function HomeCanvas({ inert }) {
  const { datasets, boards, openInData, go, setPendingFiles } = useApp();
  const [picked, setPicked] = useState(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef(null);

  const months = useMemo(() => [...new Set(boards.map(b => b.date.slice(0, 7)))].sort().reverse(), [boards]);
  const month = picked && months.includes(picked) ? picked : (months[0] || null);
  const inMonth = useMemo(() => (month ? boards.filter(b => b.date.startsWith(month)) : []), [boards, month]);
  const dates = useMemo(() => [...new Set(inMonth.map(b => b.date))].sort(), [inMonth]);
  const alliances = useMemo(() => {
    const others = [...new Set(inMonth.map(b => b.alliance))].filter(a => !MAIN_ALLIANCES.includes(a)).sort();
    return [...MAIN_ALLIANCES, ...others];
  }, [inMonth]);
  const at = useMemo(() => {
    const m = new Map();
    for (const b of inMonth) {
      const k = b.alliance + '|' + b.date;
      if (!m.has(k)) m.set(k, b);
    }
    return m;
  }, [inMonth]);
  // A column is called by the scoring day most of its boards were saved as.
  const labelFor = useMemo(() => {
    const out = {};
    for (const d of dates) {
      const count = new Map();
      for (const b of inMonth) if (b.date === d && b.label) count.set(b.label, (count.get(b.label) || 0) + 1);
      const top = [...count.entries()].sort((x, y) => y[1] - x[1])[0];
      out[d] = top ? top[0] : 'Board';
    }
    return out;
  }, [dates, inMonth]);
  const most = Math.max(1, ...inMonth.map(b => b.rows || 0));
  const captured = inMonth.length;
  const possible = dates.length * alliances.length;

  const take = list => {
    const files = [...(list || [])].filter(f => f && f.size);
    if (!files.length) return;
    setPendingFiles(files);
    go('extract');
  };
  const latest = boards[0];

  return (
    <div className="home" inert={inert}
         onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } }}
         onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
         onDrop={e => {
           if (!hasFiles(e)) return;
           e.preventDefault();
           setOver(false);
           take(e.dataTransfer.files);
         }}>
      <div className="home__in">
        <header className="home__head">
          <h1>Boards</h1>
          <p>{datasets ? `${n(boards.length)} boards · ${n(datasets.roster.rows)} players` : 'Loading…'}</p>
        </header>

        <button type="button" className={'capsule' + (over ? ' is-over' : '')}
                onClick={() => fileInput.current && fileInput.current.click()}>
          <span className="capsule__icon" aria-hidden="true">↑</span>
          <span className="capsule__text">
            <b>{over ? 'Let go to read it' : 'Drop a recording'}</b>
            <span>{latest
              ? `Latest: ${latest.alliance} · ${latest.label || 'board'} · ${dayOf(latest.date)} · ${n(latest.rows)} rows`
              : 'A screen recording of the leaderboard, one per alliance'}</span>
          </span>
          <span className="capsule__cta" aria-hidden="true">Choose</span>
        </button>
        <input ref={fileInput} type="file" accept="video/*" multiple className="hide"
               onChange={e => { take(e.target.files); e.target.value = ''; }} />

        {months.length > 0 && (
          <nav className="months" aria-label="Month">
            {months.map(m => (
              <button key={m} type="button" className="monthchip" aria-pressed={m === month}
                      onClick={() => setPicked(m)}>{fmtMonth(m)}</button>
            ))}
          </nav>
        )}

        {!datasets ? (
          <div className="loading">Loading boards…</div>
        ) : !months.length ? (
          <div className="home__empty">
            <b>No boards yet</b>
            <span>Drop a recording above, or start an empty board from the menu.</span>
          </div>
        ) : (
          <section className="cal" aria-label={`Boards in ${fmtMonth(month)}`}>
            <div className="cal__meta">
              <h2>{fmtMonth(month)}</h2>
              <span>{captured} of {possible} captured</span>
            </div>
            <div className="cal__scroll">
              <div className="cal__grid" style={{ '--cols': dates.length }}>
                <span aria-hidden="true" />
                {dates.map(d => (
                  <div key={d} className="cal__day"><b>{labelFor[d]}</b><span>{dayOf(d)}</span></div>
                ))}
                {alliances.map(a => (
                  <Fragment key={a}>
                    <div className="cal__alli" style={{ '--ac': hue(a) }}><i aria-hidden="true" />{a}</div>
                    {dates.map(d => {
                      const b = at.get(a + '|' + d);
                      return b ? (
                        <button key={d} type="button" className="tile" style={{ '--ac': hue(a) }}
                                onClick={() => openInData({ kind: 'dataset', key: b.key })}
                                aria-label={`${a}, ${labelFor[d]}, ${dayOf(d)}: ${n(b.rows)} rows`}>
                          <span className="tile__n">{n(b.rows)}</span>
                          <span className="tile__m">rows{typeof b.best === 'number' ? ` · best ${n(b.best)}` : ''}</span>
                          <span className="tile__bar" aria-hidden="true">
                            <i style={{ width: Math.max(4, Math.round(((b.rows || 0) / most) * 100)) + '%' }} />
                          </span>
                        </button>
                      ) : (
                        <div key={d} className="tile tile--empty">not captured</div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="shortcuts" aria-label="Lists and views">
          <button type="button" className="shortcut" onClick={() => openInData({ kind: 'dataset', key: 'roster' })}>
            <b>Roster</b>
            <span>{datasets ? `${n(datasets.roster.rows)} players, and who is who` : 'who is who'}</span>
          </button>
          {VIEWS.map(v => (
            <button key={v.id} type="button" className="shortcut"
                    onClick={() => openInData({ kind: 'view', id: v.id })}>
              <b>{v.label}</b><span>{v.hint}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
