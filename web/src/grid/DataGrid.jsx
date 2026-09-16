/**
 * The grid.
 *
 * It draws rows, moves a selection around them, and lets a cell be typed into. It owns nothing
 * else: the data, what an edit means, what a paste should create and where a row goes are the
 * workspace's business, reached through callbacks. That separation is the point — the database
 * has no idea this file exists, and this file has no idea there is a database.
 *
 * Only the rows on screen are in the DOM. Fifteen thousand rows is a container of the right
 * height and about forty rows inside it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fromTsv, toTsv, writeClipboard } from './clipboard.js';
import { cssFor, styleFor } from '../data/format.js';
import { useDark } from '../utils/theme.js';
import Portal from '../components/shared/Portal.jsx';

const OVERSCAN = 8;
const MIN_W = 56, MAX_W = 640;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const norm = sel => ({
  r0: Math.min(sel.ar, sel.fr), r1: Math.max(sel.ar, sel.fr),
  c0: Math.min(sel.ac, sel.fc), c1: Math.max(sel.ac, sel.fc),
});

export default function DataGrid({
  columns, rows, rowHeight = 30,
  sort, onSortToggle,
  onEdit, onPaste, onInsert, onDelete, onDuplicate, onClear,
  onResize, onMoveColumn, onAddRow,
  menuItems, onSelectionChange,
  rowFlags, findHit, onFormat, focusRef,
  readOnly = false, emptyText = 'No rows',
}) {
  // The swatch a cell wears is a name; which half of the pair it resolves to is the theme's
  // business — the device's setting or the one chosen in the app — so a mark made in daylight is
  // still legible at night.
  const dark = useDark();
  const hostRef = useRef(null);
  // A toolbar button takes the focus with it when it is clicked, and a grid that has lost the
  // focus no longer hears Ctrl+B. Whoever draws the toolbar gets a way to hand the focus back.
  if (focusRef) focusRef.current = () => hostRef.current && hostRef.current.focus();
  const [view, setView] = useState({ top: 0, height: 600, width: 900 });
  const [sel, setSel] = useState({ ar: 0, ac: 0, fr: 0, fc: 0 });
  const [editing, setEditing] = useState(null);      // { r, c, value, replace }
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(null);            // column reorder
  const dragCell = useRef(false);                    // mouse-drag selection in progress
  const editRef = useRef(null);

  const cols = useMemo(() => columns.filter(c => !c.hidden), [columns]);
  // Stored widths are what the user set. When the columns do not reach the right-hand edge they
  // are stretched to fill it — a table with a ragged edge and four hundred pixels of nothing
  // beside it looks like a widget dropped on a page rather than the application's own surface.
  // Stretching is drawing only: what gets saved is still the width that was dragged.
  const widths = useMemo(() => {
    const base = cols.map(c => clamp(c.width || 130, MIN_W, MAX_W));
    const avail = view.width - 52 - 2;
    const total = base.reduce((a, b) => a + b, 0);
    if (!total || avail <= total) return base;
    // The surplus goes to the columns that hold words. A rank and a score are three or six
    // characters however much room there is, and widening them only pushes the names further
    // from the numbers they belong to.
    const wide = cols.map(c => c.type !== 'int');
    const anyWide = wide.some(Boolean);
    const share = base.reduce((a, w, i) => a + (!anyWide || wide[i] ? w : 0), 0);
    const surplus = avail - total;
    return base.map((w, i) => (!anyWide || wide[i]
      ? Math.round(w + (surplus * w) / share) : w));
  }, [cols, view.width]);
  const offsets = useMemo(() => {
    const out = [];
    let x = 0;
    for (const w of widths) { out.push(x); x += w; }
    return out;
  }, [widths]);
  const totalW = offsets.length ? offsets[offsets.length - 1] + widths[widths.length - 1] : 0;
  const bodyH = rows.length * rowHeight;

  // ---- the window of rows actually drawn ---------------------------------------------------
  const measure = useCallback(() => {
    const el = hostRef.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const first = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN);
  const window_ = rows.slice(first, last);

  // ---- selection ----------------------------------------------------------------------------
  const box = norm(sel);
  useEffect(() => {
    if (!onSelectionChange) return;
    const b = norm(sel);
    onSelectionChange({
      ...b,
      rowIds: rows.slice(b.r0, b.r1 + 1).map(r => r.id),
      columns: cols.slice(b.c0, b.c1 + 1).map(c => c.key),
      cells: (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1),
    });
  }, [sel, rows, cols, onSelectionChange]);

  // A dataset that shrank under the cursor must not leave the selection pointing past its end.
  useEffect(() => {
    setSel(s => ({
      ar: clamp(s.ar, 0, Math.max(0, rows.length - 1)), fr: clamp(s.fr, 0, Math.max(0, rows.length - 1)),
      ac: clamp(s.ac, 0, Math.max(0, cols.length - 1)), fc: clamp(s.fc, 0, Math.max(0, cols.length - 1)),
    }));
  }, [rows.length, cols.length]);

  const scrollTo = useCallback((r, c) => {
    const el = hostRef.current;
    if (!el) return;
    const top = r * rowHeight, bottom = top + rowHeight;
    const headH = 30;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight - headH) el.scrollTop = bottom - el.clientHeight + headH;
    if (c !== undefined && offsets[c] !== undefined) {
      const left = offsets[c], right = left + widths[c];
      const gut = 52;
      if (left < el.scrollLeft) el.scrollLeft = left;
      else if (right > el.scrollLeft + el.clientWidth - gut) el.scrollLeft = right - el.clientWidth + gut;
    }
  }, [rowHeight, offsets, widths]);

  const move = useCallback((dr, dc, extend) => {
    setSel(s => {
      const r = clamp(s.fr + dr, 0, Math.max(0, rows.length - 1));
      const c = clamp(s.fc + dc, 0, Math.max(0, cols.length - 1));
      scrollTo(r, c);
      return extend ? { ...s, fr: r, fc: c } : { ar: r, ac: c, fr: r, fc: c };
    });
  }, [rows.length, cols.length, scrollTo]);

  const goto = useCallback((r, c, extend) => {
    setSel(s => (extend ? { ...s, fr: r, fc: c } : { ar: r, ac: c, fr: r, fc: c }));
    scrollTo(r, c);
  }, [scrollTo]);

  // ---- editing -------------------------------------------------------------------------------
  const cellValue = (row, col) => {
    const v = row ? row[col.key] : null;
    return v === null || v === undefined ? '' : v;
  };

  const beginEdit = useCallback((r, c, replaceWith) => {
    if (readOnly) return;
    const col = cols[c], row = rows[r];
    if (!col || !row || col.readOnly) return;
    setEditing({ r, c, value: replaceWith !== undefined ? replaceWith : String(cellValue(row, col)),
                 replace: replaceWith !== undefined });
  }, [cols, rows, readOnly]);

  const commitEdit = useCallback((next) => {
    setEditing(cur => {
      if (!cur) return null;
      const col = cols[cur.c], row = rows[cur.r];
      if (col && row && String(cellValue(row, col)) !== cur.value)
        onEdit && onEdit([{ id: row.id, key: col.key, value: cur.value }]);
      if (next) { const { dr, dc } = next; setTimeout(() => move(dr, dc, false), 0); }
      return null;
    });
  }, [cols, rows, onEdit, move]);

  // Focus and select once, when the edit opens — not on every keystroke. Selecting on each
  // change made typing replace what had just been typed, so "12345" came out as "5".
  const editingAt = editing ? editing.r + ':' + editing.c : '';
  useLayoutEffect(() => {
    if (!editingAt || !editRef.current) return;
    editRef.current.focus();
    if (!editing.replace) editRef.current.select();
  }, [editingAt]);

  // A toggle inverts what the focused cell has, which is how every editor decides whether
  // Ctrl+B is switching bold on or off.
  const currentStyle = useCallback(
    () => styleFor(rows[sel.fr], cols[sel.fc] && cols[sel.fc].key), [rows, cols, sel]);

  // ---- clipboard -------------------------------------------------------------------------------
  const selectionMatrix = useCallback(() => {
    const b = norm(sel);
    return rows.slice(b.r0, b.r1 + 1).map(row => cols.slice(b.c0, b.c1 + 1).map(c => cellValue(row, c)));
  }, [sel, rows, cols]);

  const doCopy = useCallback(async () => {
    const text = toTsv(selectionMatrix());
    await writeClipboard(text);
    return text;
  }, [selectionMatrix]);

  const clearSelection = useCallback(() => {
    if (readOnly || !onClear) return;
    const b = norm(sel);
    const cells = [];
    for (const row of rows.slice(b.r0, b.r1 + 1))
      for (const c of cols.slice(b.c0, b.c1 + 1)) if (!c.readOnly) cells.push({ id: row.id, key: c.key });
    if (cells.length) onClear(cells);
  }, [sel, rows, cols, readOnly, onClear]);

  const applyPaste = useCallback(text => {
    const matrix = fromTsv(text);
    if (!matrix.length || !onPaste) return;
    const b = norm(sel);
    onPaste({ rowIndex: b.r0, colIndex: b.c0, matrix });
  }, [sel, onPaste]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onCopy = e => {
      if (editing || !el.contains(document.activeElement)) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', toTsv(selectionMatrix()));
    };
    const onCut = e => {
      if (editing || readOnly || !el.contains(document.activeElement)) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', toTsv(selectionMatrix()));
      clearSelection();
    };
    const onPasteEvent = e => {
      if (editing || readOnly || !el.contains(document.activeElement)) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      applyPaste(text);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPasteEvent);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPasteEvent);
    };
  }, [editing, readOnly, selectionMatrix, clearSelection, applyPaste]);

  // ---- keyboard ---------------------------------------------------------------------------------
  const onKeyDown = e => {
    if (editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const b = norm(sel);
    const lastRow = Math.max(0, rows.length - 1), lastCol = Math.max(0, cols.length - 1);
    const page = Math.max(1, Math.floor(view.height / rowHeight) - 1);

    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel({ ar: 0, ac: 0, fr: lastRow, fc: lastCol }); return; }
    if (mod && (e.key === 'c' || e.key === 'x' || e.key === 'v')) return;   // the document handlers have these
    if (mod && !readOnly && onFormat && 'biu'.includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = { b: 'b', i: 'i', u: 'u' }[e.key.toLowerCase()];
      onFormat({ [k]: !(currentStyle() || {})[k] });
      return;
    }

    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); mod ? goto(0, sel.fc, e.shiftKey) : move(-1, 0, e.shiftKey); return;
      case 'ArrowDown':  e.preventDefault(); mod ? goto(lastRow, sel.fc, e.shiftKey) : move(1, 0, e.shiftKey); return;
      case 'ArrowLeft':  e.preventDefault(); mod ? goto(sel.fr, 0, e.shiftKey) : move(0, -1, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); mod ? goto(sel.fr, lastCol, e.shiftKey) : move(0, 1, e.shiftKey); return;
      case 'PageUp':     e.preventDefault(); move(-page, 0, e.shiftKey); return;
      case 'PageDown':   e.preventDefault(); move(page, 0, e.shiftKey); return;
      case 'Home':       e.preventDefault(); goto(mod ? 0 : sel.fr, 0, e.shiftKey); return;
      case 'End':        e.preventDefault(); goto(mod ? lastRow : sel.fr, lastCol, e.shiftKey); return;
      case 'Tab':        e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); return;
      case 'Enter':
        e.preventDefault();
        if (e.altKey && onInsert && !readOnly) onInsert(b.r1, 'below');
        else beginEdit(sel.fr, sel.fc);
        return;
      case 'F2':         e.preventDefault(); beginEdit(sel.fr, sel.fc); return;
      case 'Escape':     e.preventDefault(); setSel(s => ({ ar: s.fr, ac: s.fc, fr: s.fr, fc: s.fc })); return;
      case 'Backspace':
      case 'Delete':     e.preventDefault(); clearSelection(); return;
      default: break;
    }
    // Typing over a cell replaces it, the way every spreadsheet behaves.
    if (!mod && !e.altKey && e.key.length === 1) { e.preventDefault(); beginEdit(sel.fr, sel.fc, e.key); }
  };

  // ---- pointer ------------------------------------------------------------------------------------
  useEffect(() => {
    const up = () => { dragCell.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const cellDown = (e, r, c) => {
    if (e.button === 2) {            // a right-click inside the selection keeps it
      const b = norm(sel);
      if (r < b.r0 || r > b.r1 || c < b.c0 || c > b.c1) goto(r, c, false);
      return;
    }
    if (editing) commitEdit();
    dragCell.current = true;
    goto(r, c, e.shiftKey);
    hostRef.current && hostRef.current.focus();
  };
  const cellEnter = (r, c) => { if (dragCell.current) setSel(s => ({ ...s, fr: r, fc: c })); };

  const rowDown = (e, r) => {
    if (editing) commitEdit();
    const lastCol = Math.max(0, cols.length - 1);
    setSel(s => (e.shiftKey ? { ...s, fr: r, fc: lastCol } : { ar: r, ac: 0, fr: r, fc: lastCol }));
    hostRef.current && hostRef.current.focus();
  };

  // The clipboard entries are the grid's own — it is the only thing that knows what is
  // selected — and whatever the workspace adds comes after them.
  const openMenu = (e, r, c) => {
    e.preventDefault();
    const b = norm(sel);
    const mac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
    const cmd = mac ? '\u2318' : 'Ctrl+';
    const own = r < 0 ? [] : [
      { label: 'Copy', hint: cmd + 'C', run: doCopy },
      { label: 'Cut', hint: cmd + 'X', disabled: readOnly,
        run: async () => { await doCopy(); clearSelection(); } },
      { label: 'Paste', hint: cmd + 'V', disabled: readOnly || !onPaste,
        run: async () => {
          try { const t = await navigator.clipboard.readText(); if (t) applyPaste(t); }
          catch { /* the browser will only hand it over to the keyboard shortcut */ }
        } },
      { label: b.r0 === b.r1 && b.c0 === b.c1 ? 'Clear cell' : 'Clear cells', hint: 'Del',
        disabled: readOnly, run: clearSelection },
      { sep: true },
    ];
    const extra = menuItems
      ? menuItems({ rowIndex: r, colIndex: c, column: cols[c], row: rows[r], selection: b }) || []
      : [];
    const items = [...own, ...extra].filter((it, i, a) => !(it.sep && (i === 0 || i === a.length - 1 || a[i - 1].sep)));
    if (items.length) setMenu({ x: e.clientX, y: e.clientY, items });
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = e => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);

  // ---- column resize and reorder -------------------------------------------------------------------
  const startResize = (e, i) => {
    e.preventDefault(); e.stopPropagation();
    const key = cols[i].key, startX = e.clientX, startW = widths[i];
    const onMove = ev => onResize && onResize(key, clamp(startW + ev.clientX - startX, MIN_W, MAX_W));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const headDrop = i => {
    if (!drag || !onMoveColumn) { setDrag(null); return; }
    if (drag.from !== i) onMoveColumn(cols[drag.from].key, i);
    setDrag(null);
  };

  // ---- drawing ------------------------------------------------------------------------------------
  const editorBox = editing ? {
    left: 52 + offsets[editing.c], top: 30 + editing.r * rowHeight,
    width: widths[editing.c], height: rowHeight,
  } : null;

  return (
    <div className="grid" ref={hostRef} tabIndex={0} onScroll={measure} onKeyDown={onKeyDown}
         role="grid" aria-rowcount={rows.length + 1} aria-colcount={cols.length}>
      <div className="grid__canvas" style={{ width: 52 + totalW }}>
        <div className="grid__head" style={{ width: 52 + totalW }}>
          <div className="grid__corner">#</div>
          {cols.map((c, i) => (
            <div key={c.key}
                 className={'grid__th'
                   + (sort && sort.key === c.key ? ' is-sorted' : '')
                   + (drag && drag.from === i ? ' is-dragging' : '')
                   + (drag && drag.over === i && drag.from > i ? ' is-drop-before' : '')
                   + (drag && drag.over === i && drag.from < i ? ' is-drop-after' : '')}
                 style={{ width: widths[i] }}
                 title={c.header + (c.about ? ' — ' + c.about : '')}
                 draggable={!!onMoveColumn}
                 onDragStart={() => setDrag({ from: i, over: i })}
                 onDragOver={e => { e.preventDefault(); setDrag(d => (d ? { ...d, over: i } : d)); }}
                 onDrop={() => headDrop(i)}
                 onDragEnd={() => setDrag(null)}
                 onClick={() => onSortToggle && onSortToggle(c.key)}
                 onContextMenu={e => openMenu(e, -1, i)}>
              <span>{c.header}</span>
              {sort && sort.key === c.key && <span className="dir">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              {onResize && <span className="grid__grip" onMouseDown={e => startResize(e, i)}
                                 onClick={e => e.stopPropagation()} />}
            </div>
          ))}
        </div>

        <div className="grid__body" style={{ height: bodyH + (onAddRow && !readOnly ? rowHeight : 0) }}>
          {window_.map((row, k) => {
            const r = first + k;
            const flags = rowFlags ? rowFlags(row) : null;
            const inRow = r >= box.r0 && r <= box.r1;
            return (
              <div key={row.id}
                   className={'grid__row' + (flags && flags.edited ? ' is-edited' : '')
                              + (inRow && box.c0 === 0 && box.c1 === cols.length - 1 ? ' is-rowsel' : '')}
                   style={{ transform: `translateY(${r * rowHeight}px)`, height: rowHeight, width: 52 + totalW }}>
                <div className="grid__gutter" style={{ height: rowHeight }}
                     onMouseDown={e => rowDown(e, r)}
                     onContextMenu={e => openMenu(e, r, 0)}>
                  {flags && flags.edited ? <i title="corrected by hand" /> : null}
                  {r + 1}
                </div>
                {cols.map((c, i) => {
                  const selected = inRow && i >= box.c0 && i <= box.c1;
                  const focused = r === sel.fr && i === sel.fc;
                  const unsaved = flags && flags.unsaved && flags.unsaved.has(c.key);
                  const hit = findHit && findHit(row, c);
                  const v = cellValue(row, c);
                  const marked = cssFor(styleFor(row, c.key), dark);
                  return (
                    <div key={c.key}
                         className={'grid__cell'
                           + (c.type === 'int' ? ' grid__cell--num' : '')
                           + (v === '' ? ' grid__cell--muted' : '')
                           + (marked ? ' is-marked' : '')
                           + (selected ? ' is-sel' : '') + (focused ? ' is-focus' : '')
                           + (unsaved ? ' is-unsaved' : '') + (hit ? ' is-hit' : '')
                           + (c.readOnly ? ' is-readonly' : '')}
                         style={{ width: widths[i], height: rowHeight, ...marked }}
                         title={String(v)}
                         onMouseDown={e => cellDown(e, r, i)}
                         onMouseEnter={() => cellEnter(r, i)}
                         onDoubleClick={() => beginEdit(r, i)}
                         onContextMenu={e => openMenu(e, r, i)}>
                      <span>{c.type === 'int' && typeof v === 'number' ? v.toLocaleString() : v}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {onAddRow && !readOnly && (
            <button type="button" className="grid__add"
                    style={{ transform: `translateY(${bodyH}px)`, height: rowHeight }}
                    onClick={() => onAddRow()}>+ New row</button>
          )}
          {!rows.length && <div className="grid__empty">{emptyText}</div>}
        </div>

        {editing && (
          <input ref={editRef}
                 className={'grid__editor' + (cols[editing.c].type === 'int' ? ' grid__editor--num' : '')}
                 style={editorBox}
                 value={editing.value}
                 onChange={e => setEditing(s => ({ ...s, value: e.target.value }))}
                 onBlur={() => commitEdit()}
                 onKeyDown={e => {
                   e.stopPropagation();
                   if (e.key === 'Escape') { e.preventDefault(); setEditing(null); hostRef.current.focus(); }
                   else if (e.key === 'Enter') { e.preventDefault(); commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 }); hostRef.current.focus(); }
                   else if (e.key === 'Tab') { e.preventDefault(); commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 }); hostRef.current.focus(); }
                 }} />
        )}
      </div>

      {menu && <Portal><GridMenu {...menu} onClose={() => setMenu(null)} /></Portal>}
    </div>
  );
}

function GridMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - b.width - 8),
      top: Math.min(y, window.innerHeight - b.height - 8),
      visibility: 'visible',
    });
  }, [x, y]);
  return (
    <div className="menu" ref={ref} style={pos} onMouseDown={e => e.stopPropagation()} role="menu">
      {items.map((it, i) => it.sep
        ? <hr className="menu__sep" key={'s' + i} />
        : (
          <button key={it.label + i} type="button" className="menu__item" disabled={it.disabled}
                  onClick={() => { onClose(); it.run && it.run(); }}>
            <span>{it.label}</span>
            {it.hint && <span className="menu__hint">{it.hint}</span>}
          </button>
        ))}
    </div>
  );
}

export { GridMenu };
