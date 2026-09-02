// The small pieces every screen shares. Colour is an identity here, never decoration: an
// alliance owns a hue and wears it wherever it is named, and the four scales — alliance, name
// resolution, score movement, run state — never share one.
import { useEffect, useRef, useState } from 'react';
import { MAIN_ALLIANCES } from '../../extractor/config.js';

export const allianceClass = a => {
  if (!a) return '';
  const i = MAIN_ALLIANCES.indexOf(a);
  return 'c' + (i < 0 ? 'X' : i);
};

export function AllianceChip({ a }) {
  if (!a) return <span className="chip cX">unknown</span>;
  return <span className={'chip ' + allianceClass(a)}>{a}</span>;
}

// A score compared against the best on the same board, drawn behind the number.
export function ScoreCell({ v, max, ...rest }) {
  const w = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0;
  return (
    <td className="barcell num" {...rest}>
      <i style={{ width: w + '%' }} /><span>{(v ?? 0).toLocaleString()}</span>
    </td>
  );
}

export function Delta({ d }) {
  if (d === null || d === undefined || !isFinite(d)) return <span className="flat">—</span>;
  if (d > 0) return <span className="delta up">▲ {d.toLocaleString()}</span>;
  if (d < 0) return <span className="delta down">▼ {Math.abs(d).toLocaleString()}</span>;
  return <span className="delta flat">0</span>;
}

// Rank moves the other way round: a smaller number is better, so a fall in rank is a rise.
export function RankDelta({ d }) {
  if (d === null || d === undefined) return null;
  if (d > 0) return <span className="delta up">▲{d}</span>;
  if (d < 0) return <span className="delta down">▼{Math.abs(d)}</span>;
  return <span className="delta flat">–</span>;
}

export function Sparkline({ values, w = 78, h = 20 }) {
  const v = (values || []).filter(x => typeof x === 'number');
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pt = (x, i) => [(i / (v.length - 1)) * (w - 3) + 1.5, h - 2 - ((x - lo) / span) * (h - 4)];
  const d = v.map((x, i) => { const [px, py] = pt(x, i); return `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`; }).join(' ');
  const [ex, ey] = pt(v[v.length - 1], v.length - 1);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path className="fill" d={`${d} L${w - 1.5} ${h} L1.5 ${h} Z`} />
      <path d={d} /><circle cx={ex.toFixed(1)} cy={ey.toFixed(1)} r="2" />
    </svg>
  );
}

export function Stats({ items }) {
  return (
    <div className="stats">
      {items.map(([n, l, wide], i) => (
        <div key={i} className={'stat' + (wide ? ' wide' : '')}><b>{n}</b><span>{l}</span></div>
      ))}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="stat empty">
      <b>{title}</b>
      <span className="emptysub">{children}</span>
    </div>
  );
}

export function Pill({ kind = 'new', children }) {
  return <span className={'pill p-' + kind}>{children}</span>;
}

// A button that says what it did. onClick may return a string to show for a moment, or throw
// to be refused out loud — in both cases the answer happens where the finger is.
export function FlashButton({ onClick, children, className = '', disabled, ms = 1600, ...rest }) {
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = async e => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await onClick(e);
      if (typeof out === 'string' && out) { setFlash({ text: out, cls: 'done' }); }
    } catch (err) {
      setFlash({ text: (err && err.message) || 'failed', cls: 'nope' });
    } finally {
      setBusy(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), ms);
    }
  };
  return (
    <button {...rest} className={className + (flash ? ' ' + flash.cls : '')} disabled={disabled || busy} onClick={run}>
      {flash ? flash.text : children}
    </button>
  );
}

// Sorting is per-table and remembered while the table is on screen.
export function useSort(defaultSort) {
  const [sort, setSort] = useState(defaultSort || null);
  const toggle = i => setSort(s => (s && s.i === i ? { i, desc: !s.desc } : { i, desc: true }));
  const apply = (rows, cols) => {
    if (!sort) return rows;
    const c = cols[sort.i];
    if (!c || !c.get) return rows;
    return rows.slice().sort((a, b) => {
      const x = c.get(a), y = c.get(b);
      const n = typeof x === 'number' && typeof y === 'number' ? x - y
              : String(x ?? '').localeCompare(String(y ?? ''));
      return sort.desc ? -n : n;
    });
  };
  const Head = ({ cols }) => (
    <thead><tr>{cols.map((c, i) => (
      <th key={i} className={c.get ? 'sortable' : ''} onClick={c.get ? () => toggle(i) : undefined}>
        {c.h}{sort && sort.i === i ? <span className="dir"> {sort.desc ? '▼' : '▲'}</span> : null}
      </th>
    ))}</tr></thead>
  );
  return { sort, apply, Head };
}

export const confirmAsync = msg => Promise.resolve(window.confirm(msg));
