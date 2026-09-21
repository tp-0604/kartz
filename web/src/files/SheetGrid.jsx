/**
 * A tab, drawn as it was written — and edited in place.
 *
 * Everything the file says about how it looks is applied: merged blocks, column widths, row
 * heights, frozen panes, fills, fonts, borders, number formats, conditional formats, dropdowns
 * and the pictures pasted on top. A calendar comes out a calendar and a squad map comes out a
 * map, which is the whole reason the presentation was kept at import.
 *
 * An edit rewrites the band it lands in and sends it back with the version it was made against,
 * so two people editing the same tab cannot silently overwrite each other — the same rule the
 * boards have always had. Layout sheets are read-only for members, because there is no sensible
 * row-and-column way to edit a picture made of merged cells.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import * as API from '../services/api.js';
import { isAdmin } from '../utils/roles.js';
import { BAND, bandsFor, layout, refOf, unpackBand } from './bands.js';
import { cellCss, prepareRules, prepareValidation, ruleCss, show, validationAt } from './sheetStyle.js';

const DEFAULT_COL = 100;
const DEFAULT_ROW = 22;
const ROW_HEAD = 46;
const MAX_COLS = 200;

const sum = (list, to) => { let n = 0; for (let i = 0; i < to; i++) n += list[i] || 0; return n; };

/** A typed value becomes a number when it reads like one, and stays text when it does not. */
function typed(text) {
  const s = String(text);
  if (s.trim() === '') return [null, ''];
  const n = Number(s.replace(/,/g, ''));
  if (s.trim() !== '' && Number.isFinite(n) && /^[-+]?[\d.,]+$/.test(s.trim())) return [n, 'n'];
  return [s, 'str'];
}

export default function SheetGrid({ sheet, styles, meta, fileId, onVersion, onCell }) {
  const { user, notify } = useApp();
  const [bands, setBands] = useState(() => new Map());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [upto, setUpto] = useState(0);                  // the last band asked for
  const [version, setVersion] = useState(sheet ? sheet.version : 1);
  const [at, setAt] = useState(null);                   // { r, c } — the selected cell
  const [editing, setEditing] = useState(null);         // { r, c, text }
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  const sheetId = sheet && sheet.id;
  const isLayout = sheet && sheet.shape === 'layout';
  const mayEdit = !!user && (!isLayout || isAdmin(user));

  useEffect(() => {
    setBands(new Map()); setReady(false); setUpto(0); setError(null);
    setAt(null); setEditing(null);
    setVersion(sheet ? sheet.version : 1);
  }, [sheetId]);

  // The bands wanted, fetched once each and kept.
  useEffect(() => {
    if (!sheetId) return undefined;
    let dead = false;
    const wanted = bandsFor(0, upto * BAND + BAND - 1).filter(b => !bands.has(b));
    if (!wanted.length) { setReady(true); return undefined; }
    (async () => {
      try {
        const answer = await API.sheetCells(sheetId, wanted[0] * BAND, (wanted[wanted.length - 1] + 1) * BAND - 1);
        const next = new Map(bands);
        for (const band of answer.bands || []) next.set(band.band, await unpackBand(band));
        for (const b of wanted) if (!next.has(b)) next.set(b, []);
        if (dead) return;
        setBands(next);
        setReady(true);
        if (answer.version) setVersion(answer.version);
      } catch (e) {
        if (!dead) { setError(e.message || String(e)); setReady(true); }
      }
    })();
    return () => { dead = true; };
  }, [sheetId, upto]);

  const cells = useMemo(() => {
    const all = [];
    for (const list of bands.values()) all.push(...list);
    return all;
  }, [bands]);

  const rows = Math.min(sheet ? sheet.rows || 0 : 0, (upto + 1) * BAND);
  const cols = Math.min(sheet ? sheet.cols || 0 : 0, MAX_COLS);

  const widths = useMemo(() => {
    const base = (sheet && sheet.defaults && sheet.defaults.colWidth) || DEFAULT_COL;
    const out = new Array(cols).fill(base);
    for (const col of (meta && meta.cols) || []) {
      for (let c = Math.max(0, col.min); c <= Math.min(col.max, cols - 1); c++) {
        out[c] = col.hidden ? 0 : (col.width || out[c]);
      }
    }
    return out;
  }, [sheet, meta, cols]);

  const heights = useMemo(() => {
    const base = (sheet && sheet.defaults && sheet.defaults.rowHeight) || DEFAULT_ROW;
    const out = new Array(rows).fill(base);
    for (const row of (meta && meta.rows) || []) {
      if (row.r >= 0 && row.r < rows) out[row.r] = row.hidden ? 0 : (row.height || base);
    }
    return out;
  }, [sheet, meta, rows]);

  const { grid, covered, spans } = useMemo(
    () => layout(cells, { rows, cols, merges: (meta && meta.merges) || [] }),
    [cells, rows, cols, meta]);

  const rules = useMemo(() => prepareRules((meta && meta.conditional) || [], cells), [meta, cells]);
  const lists = useMemo(() => prepareValidation((meta && meta.validation) || []), [meta]);
  const notes = useMemo(() => {
    const map = new Map();
    for (const n of (meta && meta.notes) || []) map.set(n[0] + ':' + n[1], n[2]);
    return map;
  }, [meta]);

  const frozen = (sheet && sheet.frozen) || null;
  const freezeCols = frozen ? Math.min(frozen.cols || 0, 6) : 0;
  const freezeRows = frozen ? Math.min(frozen.rows || 0, 6) : 0;

  /* ------------------------------------------------------------------ what a cell is now */
  const cellAt = useCallback((r, c) => (grid[r] ? grid[r][c] : null), [grid]);

  useEffect(() => {
    if (onCell) onCell(at ? { ...at, cell: cellAt(at.r, at.c), note: notes.get(at.r + ':' + at.c) } : null);
  }, [at, cellAt, notes, onCell]);

  /* ------------------------------------------------------------------------- the writing */
  const save = useCallback(async (r, c, text) => {
    if (!mayEdit || !sheetId) return;
    const [value, type] = typed(text);
    const before = cellAt(r, c);
    const was = before ? before[2] : null;
    if (String(was ?? '') === String(value ?? '')) { setEditing(null); return; }

    const band = Math.floor(r / BAND);
    const list = (bands.get(band) || []).filter(x => !(x[0] === r && x[1] === c));
    if (value !== null || (before && before[5])) {
      list.push([r, c, value, type, null, before ? before[5] : 0]);
    }
    list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    setSaving(true);
    try {
      const { gzipSync, strToU8 } = await import('fflate');
      const bytes = gzipSync(strToU8(JSON.stringify(list)), { level: 6 });
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const out = await API.putSlab(sheetId, {
        band, count: list.length, cells: btoa(bin), version,
        rows: Math.max(sheet.rows || 0, r + 1), cols: Math.max(sheet.cols || 0, c + 1),
        summary: `changed ${refOf(r, c)} on ${sheet.name}`
          + (was === null || was === '' ? ` to “${value ?? ''}”` : ` from “${was}” to “${value ?? ''}”`),
      });
      const next = new Map(bands);
      next.set(band, list);
      setBands(next);
      setVersion(out.version);
      if (onVersion) onVersion(out.version);
      setEditing(null);
    } catch (e) {
      if (e.status === 409) {
        notify('Somebody else changed this sheet while you were editing. Reopening it.', 'bad');
        setBands(new Map()); setReady(false); setUpto(0);
      } else {
        notify(e.message || String(e), 'bad');
      }
    } finally {
      setSaving(false);
    }
  }, [bands, cellAt, mayEdit, notify, onVersion, sheet, sheetId, version]);

  /* --------------------------------------------------------------------- moving about */
  const move = useCallback((dr, dc) => {
    setAt(prev => {
      const from = prev || { r: 0, c: 0 };
      const r = Math.max(0, Math.min(rows - 1, from.r + dr));
      const c = Math.max(0, Math.min(cols - 1, from.c + dc));
      return { r, c };
    });
  }, [rows, cols]);

  const onKeyDown = useCallback(e => {
    if (editing) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1, 0); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
    else if (k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); move(0, k === 'Tab' && e.shiftKey ? -1 : 1); }
    else if (k === 'PageDown') { e.preventDefault(); move(20, 0); }
    else if (k === 'PageUp') { e.preventDefault(); move(-20, 0); }
    else if ((e.metaKey || e.ctrlKey) && k === 'ArrowDown') { e.preventDefault(); setAt({ r: rows - 1, c: (at || {}).c || 0 }); }
    else if (k === 'Home') { e.preventDefault(); setAt({ r: (at || {}).r || 0, c: 0 }); }
    else if (k === 'Enter' || k === 'F2') {
      if (!at || !mayEdit) return;
      e.preventDefault();
      const cell = cellAt(at.r, at.c);
      setEditing({ r: at.r, c: at.c, text: cell && cell[2] !== null ? String(cell[2]) : '' });
    } else if (k === 'Escape') { setAt(null); }
    else if (k === 'Delete' || k === 'Backspace') {
      if (!at || !mayEdit) return;
      e.preventDefault();
      save(at.r, at.c, '');
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && mayEdit && at) {
      setEditing({ r: at.r, c: at.c, text: k });
    }
  }, [at, cellAt, editing, mayEdit, move, rows, save]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
    }
  }, [editing]);

  /* ------------------------------------------------------------------------- the images */
  const images = useMemo(() => {
    const list = (meta && meta.images) || [];
    return list.map(img => {
      const from = img.from || { r: 0, c: 0 };
      const to = img.to || { r: from.r + 8, c: from.c + 4 };
      return {
        asset: img.asset,
        left: ROW_HEAD + sum(widths, Math.min(from.c, cols)),
        top: sum(heights, Math.min(from.r, rows)),
        width: Math.max(24, sum(widths, Math.min(to.c, cols)) - sum(widths, Math.min(from.c, cols))),
        height: Math.max(24, sum(heights, Math.min(to.r, rows)) - sum(heights, Math.min(from.r, rows))),
      };
    }).filter(i => i.width > 8 && i.height > 8);
  }, [meta, widths, heights, cols, rows]);

  if (error) return <div className="pane"><div className="note note--bad">Could not read this sheet: {error}</div></div>;
  if (!ready) {
    return (
      <div className="sheetgrid sheetgrid--skeleton" aria-busy="true">
        <div className="skel skel--head" />
        {Array.from({ length: 14 }, (_, i) => <div key={i} className="skel skel--row" style={{ opacity: 1 - i * 0.055 }} />)}
      </div>
    );
  }
  if (!rows || !cols) return <div className="empty"><h3>Nothing on this tab</h3></div>;

  const totalWidth = ROW_HEAD + widths.reduce((a, b) => a + b, 0);
  const more = (sheet.rows || 0) > rows;

  return (
    <div className="sheetgrid" ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown}
         role="grid" aria-rowcount={sheet.rows || 0} aria-colcount={sheet.cols || 0}>
      <div className="sheetgrid__inner" style={{ width: totalWidth }}>
        <table className="sg">
          <colgroup>
            <col style={{ width: ROW_HEAD }} />
            {widths.map((w, i) => <col key={i} style={{ width: w || 0 }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sg__corner" />
              {widths.map((w, c) => (
                w ? (
                  <th key={c} className={'sg__col' + (c < freezeCols ? ' is-frozen' : '')}
                      style={c < freezeCols ? { left: ROW_HEAD + sum(widths, c) } : undefined}>
                    {refOf(0, c).replace(/\d+$/, '')}
                  </th>
                ) : null
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => {
              if (heights[r] === 0) return null;
              const frozenRow = r < freezeRows;
              return (
                <tr key={r} style={{ height: heights[r] }}
                    className={frozenRow ? 'is-frozen-row' : undefined}>
                  <th className="sg__row" style={frozenRow ? { top: 22 + sum(heights, r) } : undefined}>
                    {r + 1}
                  </th>
                  {row.map((cell, c) => {
                    if (covered.has(r + ':' + c) || !widths[c]) return null;
                    const span = spans.get(r + ':' + c);
                    const style = cell ? styles[cell[5]] : null;
                    const value = cell ? cell[2] : null;
                    const paint = ruleCss(rules, r, c, value);
                    const list = lists.length ? validationAt(lists, r, c) : null;
                    const here = at && at.r === r && at.c === c;
                    const isEditing = editing && editing.r === r && editing.c === c;
                    const note = notes.get(r + ':' + c);
                    const css = { ...cellCss(style), ...(paint || {}) };
                    if (c < freezeCols) { css.left = ROW_HEAD + sum(widths, c); }
                    return (
                      <td key={c}
                          colSpan={span ? span.cols : undefined}
                          rowSpan={span ? span.rows : undefined}
                          className={[
                            cell && cell[4] ? 'is-formula' : '',
                            cell && cell[3] === 'e' ? 'is-error' : '',
                            cell && typeof cell[2] === 'number' ? 'is-num' : '',
                            list ? 'has-list' : '',
                            here ? 'is-at' : '',
                            c < freezeCols ? 'is-frozen' : '',
                            frozenRow ? 'is-frozen-row' : '',
                          ].filter(Boolean).join(' ')}
                          style={css}
                          title={cell && cell[4] ? '= ' + cell[4] : note ? noteText(note) : undefined}
                          onMouseDown={() => { setAt({ r, c }); if (bodyRef.current) bodyRef.current.focus(); }}
                          onDoubleClick={() => {
                            if (!mayEdit) return;
                            setEditing({ r, c, text: cell && cell[2] !== null ? String(cell[2]) : '' });
                          }}>
                        {isEditing ? (
                          list && list.options ? (
                            <select ref={inputRef} className="sg__edit" defaultValue={editing.text}
                                    onChange={e => save(r, c, e.target.value)}
                                    onBlur={() => setEditing(null)}>
                              <option value="">—</option>
                              {list.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input ref={inputRef} className="sg__edit" defaultValue={editing.text}
                                   onBlur={e => save(r, c, e.target.value)}
                                   onKeyDown={e => {
                                     if (e.key === 'Enter') { e.preventDefault(); save(r, c, e.target.value); move(1, 0); }
                                     else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                                     else if (e.key === 'Tab') { e.preventDefault(); save(r, c, e.target.value); move(0, 1); }
                                   }} />
                          )
                        ) : (
                          <>
                            {cell ? show(cell, style) : ''}
                            {list ? <i className="sg__chev" aria-hidden="true" /> : null}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {images.map((img, i) => (
          <img key={i} className="sg__image" src={API.assetUrl(img.asset)} alt=""
               style={{ left: img.left, top: img.top + 22, width: img.width, height: img.height }} />
        ))}
      </div>

      {(more || saving) && (
        <div className="sg__more">
          {more && (
            <button type="button" className="btn btn--sm" onClick={() => setUpto(u => u + 1)}>
              Show the next {Math.min(BAND, (sheet.rows || 0) - rows).toLocaleString()} rows
            </button>
          )}
          <span className="hint">
            {saving ? 'Saving…' : `${rows.toLocaleString()} of ${(sheet.rows || 0).toLocaleString()} rows`}
          </span>
        </div>
      )}
    </div>
  );
}

const noteText = note => (String(note).startsWith('google:')
  ? 'This was a Sheets-only formula: ' + String(note).slice(7)
  : 'The formula behind this value was not kept.');
