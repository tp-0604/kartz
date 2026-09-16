/**
 * The two charts an answer is allowed to draw, and the rules they follow.
 *
 * Both are plain SVG, because this app has a hundred and fifty rows to show and a charting
 * library would cost more than the feature. Both are drawn to the same rules:
 *
 *  - one axis, never two;
 *  - a single series wears the application's accent and needs no legend, because the title
 *    names it; several series take a validated categorical order, assigned in fixed order and
 *    never cycled, with a legend and — up to four — a label at the end of each line;
 *  - the grid and the axis are recessive, the marks are the only saturated thing;
 *  - numbers are labels in ink, never in the series colour;
 *  - every chart can show the figures it was drawn from, which is also what makes the lighter
 *    hues legible to anyone the colours fail.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDark } from '../utils/theme.js';

// The categorical order, validated against this app's light and dark surfaces: worst adjacent
// pair ΔE 9.1 light / 8.4 dark under colour-vision deficiency, 19.6 / 19.3 in normal vision.
// Assigned in order and never cycled — past six series an answer folds the rest into "other".
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const SERIES_DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];


function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(320);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(220, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// The gap between axis labels: 1, 2, 2.5 or 5 times a power of ten, and nothing else.
function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** 12,800,000 becomes 12.8M. A chart label is read at a glance or not at all. */
export function short(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return String(n ?? '');
  const v = Number(n), a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** The tooltip every chart shares: it follows the pointer and never covers what it describes. */
function Tip({ at, children }) {
  if (!at) return null;
  const left = Math.min(at.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 200);
  const top = Math.max(8, at.y - 38);
  // Drawn at the top of the document: inside the glass panel, "fixed" would mean the panel.
  return createPortal(<div className="charttip" style={{ left, top }}>{children}</div>, document.body);
}

// ---------------------------------------------------------------------------------------
// Ranking, distribution, category comparison
// ---------------------------------------------------------------------------------------
export function BarChart({ rows, x, y, title, note }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);

  const labelW = Math.min(150, Math.max(70, width * 0.32));
  const valueW = 56;
  const barH = 15, gap = 9;
  const height = rows.length * (barH + gap) + 6;
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1);
  const plotW = Math.max(30, width - labelW - valueW - 8);

  return (
    <figure className="viz" style={{ margin: 0 }} ref={ref}>
      {title && <figcaption className="viz__title">{title}</figcaption>}
      <svg className="chart" width={width} height={height} role="img"
           aria-label={title || `${rows.length} values`}>
        {rows.map((r, i) => {
          const w = Math.max(2, (Math.abs(r.value) / max) * plotW);
          const yy = i * (barH + gap) + 3;
          return (
            <g key={r.label + i}
               onMouseEnter={e => setHover({ i, x: e.clientX, y: e.clientY })}
               onMouseMove={e => setHover({ i, x: e.clientX, y: e.clientY })}
               onMouseLeave={() => setHover(null)}>
              {/* a transparent band so the hover target is the row, not the 15px bar */}
              <rect x="0" y={yy - 4} width={width} height={barH + 8} fill="transparent" />
              <text className="cat" x={labelW - 8} y={yy + barH - 4} textAnchor="end">
                {r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label}
              </text>
              <rect className={'chart__bar' + (hover && hover.i === i ? ' is-hover' : '')}
                    x={labelW} y={yy} width={w} height={barH} rx="4" />
              <text className="val" x={labelW + w + 7} y={yy + barH - 3}>{short(r.value)}</text>
            </g>
          );
        })}
      </svg>
      {note && <figcaption className="viz__note">{note}</figcaption>}
      {!title && (x || y) && (
        <figcaption className="viz__note">{[y, x].filter(Boolean).join(' by ')}</figcaption>
      )}
      <button className="viz__toggle" onClick={() => setTable(t => !t)}>
        {table ? 'Hide the numbers' : 'Show the numbers'}
      </button>
      {table && <PlainTable columns={[x || 'Name', y || 'Value']}
                            rows={rows.map(r => [r.label, r.value.toLocaleString()])} />}
      <Tip at={hover}>
        {hover && <><b>{rows[hover.i].label}</b><br />{rows[hover.i].value.toLocaleString()}</>}
      </Tip>
    </figure>
  );
}

// ---------------------------------------------------------------------------------------
// Change over time
// ---------------------------------------------------------------------------------------
export function LineChart({ series, x, y, title, note }) {
  const [ref, width] = useWidth();
  const dark = useDark();
  const palette = dark ? SERIES_DARK : SERIES_LIGHT;
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);

  const many = series.length > 1;
  const padL = 46, padR = many && series.length <= 4 ? 64 : 12, padT = 8;
  const padB = 22;
  const height = 190;
  const plotW = Math.max(40, width - padL - padR);
  const plotH = height - padT - padB;

  // Every series shares one x scale, taken from the first that has the most points, and one y —
  // never two, because a second y-axis lets any two lines be made to cross wherever you like.
  const labels = [];
  for (const s of series) for (const p of s.points) if (!labels.includes(p.x)) labels.push(p.x);
  const values = series.flatMap(s => s.points.map(p => p.y));
  let lo = Math.min(...values), hi = Math.max(...values);
  if (lo === hi) { lo -= 1; hi += 1; }
  // A count or a total is read against zero; a level that never approaches it is not.
  if (lo > 0 && lo < (hi - lo)) lo = 0;
  // Axis labels are read, so they are round numbers with a round gap between them. 669.8 is a
  // number the data never contained and nobody asked for.
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const px = i => padL + (labels.length < 2 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const py = v => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

  const gridAt = [];
  for (let v = lo; v <= hi + step / 2; v += step) gridAt.push(v);
  const everyNth = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 62))));

  const onMove = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - box.left - padL;
    const i = Math.max(0, Math.min(labels.length - 1,
      Math.round((rel / plotW) * (labels.length - 1))));
    setHover({ i, x: e.clientX, y: e.clientY });
  };

  return (
    <figure className="viz" style={{ margin: 0 }} ref={ref}>
      {title && <figcaption className="viz__title">{title}</figcaption>}
      {many && (
        <div className="viz__legend">
          {series.map((s, i) => (
            <span key={s.name}><i style={{ background: palette[i % palette.length] }} />{s.name}</span>
          ))}
        </div>
      )}
      <svg className="chart" width={width} height={height} role="img"
           aria-label={title || 'a trend'} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridAt.map((v, i) => (
          <g key={i}>
            <line className="grid-line" x1={padL} x2={padL + plotW} y1={py(v)} y2={py(v)} />
            <text className="tick" x={padL - 7} y={py(v) + 3} textAnchor="end">{short(v)}</text>
          </g>
        ))}
        <line className="axis-line" x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH} />
        {labels.map((l, i) => (i % everyNth === 0 || i === labels.length - 1) && (
          <text key={l} className="tick" x={px(i)} y={height - 6} textAnchor="middle">{l.slice(-5)}</text>
        ))}

        {hover && <line className="crosshair" x1={px(hover.i)} x2={px(hover.i)} y1={padT} y2={padT + plotH} />}

        {series.map((s, si) => {
          const colour = many ? palette[si % palette.length] : 'var(--accent)';
          const pts = s.points.map(p => ({ i: labels.indexOf(p.x), y: p.y })).filter(p => p.i >= 0);
          const d = pts.map((p, k) => `${k ? 'L' : 'M'}${px(p.i).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
          const at = hover ? pts.find(p => p.i === hover.i) : null;
          const end = pts[pts.length - 1];
          return (
            <g key={s.name}>
              <path className="series-line" d={d} stroke={colour} />
              {at && <circle className="series-dot" cx={px(at.i)} cy={py(at.y)} r="4.5" fill={colour} />}
              {many && series.length <= 4 && end && (
                <text className="series-label" x={px(end.i) + 7} y={py(end.y) + 3} fill={colour}>
                  {s.name.length > 9 ? s.name.slice(0, 8) + '…' : s.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {note && <figcaption className="viz__note">{note}</figcaption>}
      {!title && (x || y) && (
        <figcaption className="viz__note">{[y, x].filter(Boolean).join(' over ')}</figcaption>
      )}
      <button className="viz__toggle" onClick={() => setTable(t => !t)}>
        {table ? 'Hide the numbers' : 'Show the numbers'}
      </button>
      {table && (
        <PlainTable columns={[x || 'When', ...series.map(s => s.name)]}
                    rows={labels.map(l => [l, ...series.map(s => {
                      const p = s.points.find(q => q.x === l);
                      return p ? p.y.toLocaleString() : '—';
                    })])} />
      )}
      <Tip at={hover}>
        {hover && (
          <>
            <b>{labels[hover.i]}</b>
            {series.map(s => {
              const p = s.points.find(q => q.x === labels[hover.i]);
              return p ? <div key={s.name}>{many ? s.name + ': ' : ''}{p.y.toLocaleString()}</div> : null;
            })}
          </>
        )}
      </Tip>
    </figure>
  );
}

export function PlainTable({ columns, rows }) {
  return (
    <div className="tablewrap" style={{ maxHeight: 320 }}>
      <table className="tbl">
        <thead><tr>{columns.map((c, i) => <th key={i} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, k) => <td key={k} className={k ? 'num' : ''}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
