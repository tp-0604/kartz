/**
 * A tab, drawn as it was written.
 *
 * Values, fonts, fills, borders, merged blocks, column widths and row heights — all of it comes
 * from the file, so a calendar looks like a calendar and a squad map looks like a map rather
 * than like a table of the same words. The grid arrives a band at a time; this asks for the
 * bands it needs and keeps the ones it has.
 *
 * Read-only for now. Editing a cell here is the next piece, and it goes through the same
 * version-checked save the boards already use.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as API from '../services/api.js';
import { bandsFor, layout, refOf, BAND } from './bands.js';
import { unpackBand } from './bands.js';

const DEFAULT_COL = 100;
const DEFAULT_ROW = 21;
const MAX_COLS = 200;

/** A number as the file's format asks for it, without pretending to be a spreadsheet engine. */
function show(cell, style) {
  const v = cell[2];
  if (v === null || v === undefined) return '';
  if (cell[3] === 'e') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  const fmt = style && style.numFmt;
  if (fmt && /[dmy]/i.test(fmt.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''))) {
    // An Excel serial: days since 1899-12-30, which is the one date everybody agrees on.
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    if (Number.isFinite(d.getTime())) {
      return /h|s/i.test(fmt)
        ? d.toISOString().slice(0, 16).replace('T', ' ')
        : d.toISOString().slice(0, 10);
    }
  }
  if (fmt && fmt.indexOf('%') !== -1) return (v * 100).toFixed(fmt.indexOf('.') === -1 ? 0 : 1) + '%';
  if (fmt && fmt.indexOf(',') !== -1) return v.toLocaleString();
  return String(Math.round(v * 1e10) / 1e10);
}

const SIDES = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };
const WEIGHT = { hair: '1px', thin: '1px', medium: '2px', thick: '3px', double: '3px' };

/** One cell's style, as the browser wants it. */
function styleOf(style, tabColor) {
  if (!style) return undefined;
  const css = {};
  if (style.fill) css.background = style.fill;
  if (style.color) css.color = style.color;
  if (style.bold) css.fontWeight = 700;
  if (style.italic) css.fontStyle = 'italic';
  if (style.underline) css.textDecoration = 'underline';
  if (style.strike) css.textDecoration = (css.textDecoration ? css.textDecoration + ' ' : '') + 'line-through';
  if (style.size) css.fontSize = Math.max(9, Math.min(28, style.size)) + 'px';
  if (style.align) css.textAlign = style.align;
  if (style.valign) css.verticalAlign = style.valign === 'center' ? 'middle' : style.valign;
  if (style.wrap) { css.whiteSpace = 'normal'; css.wordBreak = 'break-word'; }
  if (style.indent) css.paddingLeft = (6 + style.indent * 8) + 'px';
  if (style.border) {
    for (const [side, spec] of Object.entries(style.border)) {
      if (!SIDES[side] || !spec) continue;
      css['border' + SIDES[side]] =
        `${WEIGHT[spec.style] || '1px'} ${spec.style === 'double' ? 'double' : 'solid'} ${spec.color || 'currentColor'}`;
    }
  }
  return css;
}

export default function SheetGrid({ sheet, styles, meta, onCell }) {
  const [cells, setCells] = useState(null);
  const [error, setError] = useState(null);
  const [band, setBand] = useState(0);
  const got = useRef(new Map());
  const scroller = useRef(null);

  const sheetId = sheet && sheet.id;

  // Whenever the tab changes, everything held for the last one goes.
  useEffect(() => { got.current = new Map(); setCells(null); setBand(0); setError(null); }, [sheetId]);

  useEffect(() => {
    if (!sheetId) return undefined;
    let dead = false;
    const wanted = bandsFor(band * BAND, (band + 1) * BAND - 1);
    const missing = wanted.filter(b => !got.current.has(b));
    if (!missing.length) return undefined;
    (async () => {
      try {
        const answer = await API.sheetCells(sheetId, missing[0] * BAND, (missing[missing.length - 1] + 1) * BAND - 1);
        for (const b of answer.bands || []) got.current.set(b.band, await unpackBand(b));
        for (const b of missing) if (!got.current.has(b)) got.current.set(b, []);
        if (dead) return;
        const all = [];
        for (const list of got.current.values()) all.push(...list);
        all.sort((a, b2) => a[0] - b2[0] || a[1] - b2[1]);
        setCells(all);
      } catch (e) {
        if (!dead) setError(e.message || String(e));
      }
    })();
    return () => { dead = true; };
  }, [sheetId, band]);

  const widths = useMemo(() => {
    const cols = Math.min(sheet ? sheet.cols || 0 : 0, MAX_COLS);
    const out = new Array(cols).fill((sheet && sheet.defaults && sheet.defaults.colWidth) || DEFAULT_COL);
    for (const col of (meta && meta.cols) || []) {
      for (let c = col.min; c <= Math.min(col.max, cols - 1); c++) {
        if (c < 0) continue;
        out[c] = col.hidden ? 0 : (col.width || out[c]);
      }
    }
    return out;
  }, [sheet, meta]);

  const heights = useMemo(() => {
    const map = new Map();
    for (const row of (meta && meta.rows) || []) map.set(row.r, row.hidden ? 0 : row.height || null);
    return map;
  }, [meta]);

  const rows = Math.min(sheet ? sheet.rows || 0 : 0, (band + 1) * BAND);
  const cols = Math.min(sheet ? sheet.cols || 0 : 0, MAX_COLS);

  const { grid, covered, spans } = useMemo(
    () => layout(cells || [], { rows, cols, merges: (meta && meta.merges) || [] }),
    [cells, rows, cols, meta]);

  if (error) return <div className="note note--bad">Could not read this sheet: {error}</div>;
  if (!cells) return <div className="loading">Opening the sheet…</div>;
  if (!rows || !cols) return <div className="empty"><h3>Nothing on this tab</h3></div>;

  const more = (sheet.rows || 0) > rows;

  return (
    <div className="sheetgrid" ref={scroller}>
      <table className="sg" style={{ width: widths.reduce((a, b) => a + b, 0) + 44 }}>
        <colgroup>
          <col style={{ width: 44 }} />
          {widths.map((w, i) => <col key={i} style={{ width: w || 0 }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="sg__corner" />
            {widths.map((w, c) => (
              <th key={c} className={'sg__col' + (w ? '' : ' is-hidden')}>{refOf(0, c).replace(/\d+$/, '')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => {
            const h = heights.has(r) ? heights.get(r) : null;
            if (h === 0) return null;
            return (
              <tr key={r} style={h ? { height: h } : undefined}>
                <th className="sg__row">{r + 1}</th>
                {row.map((cell, c) => {
                  if (covered.has(r + ':' + c)) return null;
                  if (!widths[c]) return null;
                  const span = spans.get(r + ':' + c);
                  const style = cell ? styles[cell[5]] : null;
                  const text = cell ? show(cell, style) : '';
                  return (
                    <td key={c}
                        colSpan={span ? span.cols : undefined}
                        rowSpan={span ? span.rows : undefined}
                        className={(cell && cell[4] ? 'is-formula ' : '')
                                 + (cell && cell[3] === 'e' ? 'is-error ' : '')
                                 + (cell && typeof cell[2] === 'number' ? 'is-num' : '')}
                        style={styleOf(style)}
                        title={cell && cell[4] ? '= ' + cell[4] : (cell && cell[6]) || undefined}
                        onClick={onCell ? () => onCell({ r, c, cell }) : undefined}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {more && (
        <div className="sg__more">
          <button type="button" className="btn btn--sm" onClick={() => setBand(b => b + 1)}>
            Show the next {Math.min(BAND, (sheet.rows || 0) - rows).toLocaleString()} rows
          </button>
          <span className="hint">{rows.toLocaleString()} of {(sheet.rows || 0).toLocaleString()} rows</span>
        </div>
      )}
    </div>
  );
}
