/**
 * One dataset, open and editable.
 *
 * The rule the whole thing is built around: a keystroke never waits for a network. An edit lands
 * in the rows immediately, becomes an operation in a queue, and the queue goes to the Worker a
 * moment later as one batch — so pasting fifty rows is one request, not fifty. The version the
 * copy was loaded at rides along, so a save made against somebody else's newer copy is refused
 * rather than landing on top of it.
 *
 * Nothing is thrown away quietly. A refused cell keeps its typed value and is marked; a queue
 * that has not been sent is written to this browser two seconds after the last change, so a
 * closed tab costs nothing; and a conflict is a question, never a silent overwrite.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as API from '../services/api.js';
import { store } from '../utils/storage.js';
import { blankRow, coerce, isExtra, sortBetween } from './model.js';
import { mergeStyle } from './format.js';

const FLUSH_MS = 700;                 // long enough to gather a burst of typing, short enough to feel saved
const DRAFT_MS = 2000;
const UNDO_MAX = 60;

const newRowId = () => 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const draftKey = key => 'draft.' + key;
export const cellId = (id, key) => id + '::' + key;

const EMPTY = { dataset: null, columns: [], rows: [], version: null };

export function useDataset(key, { notify, onSaved } = {}) {
  const [data, setData] = useState(EMPTY);
  // What the rows are right now, for the callbacks that have to read them without
  // becoming a dependency of every one of them.
  const dataRef = useRef(data);
  dataRef.current = data;
  const [loading, setLoading] = useState(!!key);
  const [error, setError] = useState(null);
  const [save, setSave] = useState({ status: 'saved', pending: 0, error: null, at: null });
  const [rejected, setRejected] = useState(() => new Map());
  const [draft, setDraft] = useState(null);
  const [history, setHistory] = useState({ undo: [], redo: [] });

  const pending = useRef(new Map());          // op key → op, coalesced
  const flushTimer = useRef(null);
  const draftTimer = useRef(null);
  const inFlight = useRef(false);
  const versionRef = useRef(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  // ---- loading -------------------------------------------------------------------------------
  const load = useCallback(async (opts = {}) => {
    if (!key) { setData(EMPTY); setLoading(false); return null; }
    setLoading(true); setError(null);
    try {
      const j = await API.loadDataset(key);
      versionRef.current = j.version;
      setData({ dataset: j.dataset, columns: j.columns, rows: j.rows, version: j.version });
      setHistory({ undo: [], redo: [] });
      if (!opts.keepPending) {
        pending.current.clear();
        setSave({ status: 'saved', pending: 0, error: null, at: j.dataset.savedAt || null });
        setRejected(new Map());
        const d = store.get(draftKey(key));
        setDraft(d && Array.isArray(d.ops) && d.ops.length ? d : null);
      }
      return j;
    } catch (e) {
      setError(e.message || String(e));
      setData(EMPTY);
      return null;
    } finally { setLoading(false); }
  }, [key]);

  useEffect(() => { load(); }, [load]);

  // ---- the queue ------------------------------------------------------------------------------
  const flushRef = useRef(() => {});

  const scheduleFlush = useCallback(() => {
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => flushRef.current(), FLUSH_MS);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      // Only what has not been sent, and the version it was made against. The rows themselves
      // are the server's; re-applying these to them reproduces the work exactly.
      const ops = [...pending.current.values()];
      if (ops.length) store.set(draftKey(keyRef.current), { at: new Date().toISOString(), version: versionRef.current, ops });
      else store.del(draftKey(keyRef.current));
    }, DRAFT_MS);
  }, []);

  const enqueue = useCallback(ops => {
    for (const op of ops) {
      if (op.op === 'columns' || op.op === 'layout') {
        const was = pending.current.get(op.op);
        pending.current.set(op.op, was && op.op === 'columns' && was.rename && !op.rename
          ? { ...op, rename: was.rename } : op);
        continue;
      }
      const insertKey = 'i:' + op.id, updateKey = 'u:' + op.id, deleteKey = 'd:' + op.id;
      if (op.op === 'delete') {
        // A row created here and deleted here never needs to exist anywhere else.
        if (pending.current.has(insertKey)) { pending.current.delete(insertKey); pending.current.delete(updateKey); continue; }
        pending.current.delete(updateKey);
        pending.current.set(deleteKey, op);
        continue;
      }
      if (pending.current.has(insertKey)) {
        const was = pending.current.get(insertKey);
        pending.current.set(insertKey, { ...was, values: { ...was.values, ...op.values },
                                         style: { ...was.style, ...op.style },
                                         sort: op.sort ?? was.sort });
        continue;
      }
      if (op.op === 'insert') { pending.current.set(insertKey, op); continue; }
      const was = pending.current.get(updateKey);
      pending.current.set(updateKey, was
        ? { ...was, values: { ...was.values, ...op.values }, style: { ...was.style, ...op.style } }
        : op);
    }
    setSave(s => ({ ...s, status: 'dirty', pending: pending.current.size, error: null }));
    scheduleFlush();
  }, [scheduleFlush]);

  const flush = useCallback(async () => {
    if (inFlight.current || !keyRef.current) return;
    const ops = [...pending.current.values()];
    if (!ops.length) { setSave(s => ({ ...s, status: s.status === 'partial' ? 'partial' : 'saved', pending: 0 })); return; }
    // Order is the server's contract: the columns exist before a value is written into one,
    // and a row exists before it is updated.
    const rank = o => (o.op === 'columns' ? 0 : o.op === 'layout' ? 1 : o.op === 'insert' ? 2 : o.op === 'update' ? 3 : 4);
    ops.sort((a, b) => rank(a) - rank(b));
    const sent = new Set(pending.current.keys());
    inFlight.current = true;
    setSave(s => ({ ...s, status: 'saving', pending: ops.length }));
    try {
      const out = await API.applyOps(keyRef.current, { version: versionRef.current, ops });
      versionRef.current = out.version;
      for (const k of sent) pending.current.delete(k);
      setData(d => ({ ...d, version: out.version }));
      store.del(draftKey(keyRef.current));
      const bad = new Map();
      for (const r of out.rejected || []) if (r.id && r.field) bad.set(cellId(r.id, r.field), r.reason);
      setRejected(bad);
      setSave({ status: pending.current.size ? 'dirty' : (bad.size ? 'partial' : 'saved'),
                pending: pending.current.size, error: null, at: out.savedAt || new Date().toISOString() });
      if (bad.size && notify)
        notify(`${bad.size} cell${bad.size > 1 ? 's were' : ' was'} not saved — the red cell says why.`, 'warn', 6000);
      if (onSaved) onSaved(out);
      if (pending.current.size) scheduleFlush();
    } catch (e) {
      if (e instanceof API.ApiError && e.status === 409) {
        setSave({ status: 'conflict', pending: pending.current.size, at: null,
                  error: e.message });
      } else {
        setSave({ status: 'failed', pending: pending.current.size, at: null,
                  error: e.message || String(e) });
      }
    } finally { inFlight.current = false; }
  }, [notify, onSaved, scheduleFlush]);
  flushRef.current = flush;

  const flushNow = useCallback(async () => { clearTimeout(flushTimer.current); await flush(); }, [flush]);

  /** Take the conflict: reload their rows, then put this queue on top of them — or drop it. */
  const resolveConflict = useCallback(async keep => {
    clearTimeout(flushTimer.current);
    if (!keep) { pending.current.clear(); setRejected(new Map()); await load(); return; }
    const j = await load({ keepPending: true });
    if (!j) return;
    setSave(s => ({ ...s, status: 'dirty', error: null }));
    await flush();
  }, [load, flush]);

  useEffect(() => {
    const warn = e => { if (pending.current.size) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => () => { clearTimeout(flushTimer.current); clearTimeout(draftTimer.current); }, []);

  // ---- changing rows ----------------------------------------------------------------------------
  /**
   * Every change goes through here: it applies to the rows, works out the change that would put
   * them back, records that for undo, and queues the operations for the Worker.
   */
  const apply = useCallback((change, { undoable = true } = {}) => {
    setData(d => {
      const byKey = new Map(d.columns.map(c => [c.key, c]));
      const index = new Map(d.rows.map((r, i) => [r.id, i]));
      let rows = d.rows;
      const ops = [];
      const inverse = { edits: [], inserts: [], deletes: [], styles: [] };

      if (change.edits && change.edits.length) {
        const patch = new Map();
        for (const e of change.edits) {
          const col = byKey.get(e.key);
          if (!col || col.readOnly) continue;
          const i = index.get(e.id);
          if (i === undefined) continue;
          const value = coerce(col, e.value);
          const was = rows[i][e.key] ?? null;
          if (was === value) continue;
          inverse.edits.push({ id: e.id, key: e.key, value: was });
          if (!patch.has(e.id)) patch.set(e.id, {});
          patch.get(e.id)[e.key] = value;
        }
        if (patch.size) {
          rows = rows.map(r => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r));
          for (const [id, values] of patch) ops.push({ op: 'update', id, values });
        }
      }

      // Marking up: a fill, a colour, a weight. It rides the same queue as an edit and is undone
      // the same way, but it is not a correction — the server does not mark the row edited for it.
      if (change.styles && change.styles.length) {
        const patch = new Map();
        for (const st of change.styles) {
          const i = index.get(st.id);
          if (i === undefined) continue;
          const was = (rows[i].__style && rows[i].__style[st.key]) || null;
          if (JSON.stringify(was) === JSON.stringify(st.style)) continue;
          inverse.styles.push({ id: st.id, key: st.key, style: was });
          if (!patch.has(st.id)) patch.set(st.id, {});
          patch.get(st.id)[st.key] = st.style;
        }
        if (patch.size) {
          rows = rows.map(r => {
            if (!patch.has(r.id)) return r;
            const bag = { ...(r.__style || {}) };
            for (const [k, v] of Object.entries(patch.get(r.id))) { if (v) bag[k] = v; else delete bag[k]; }
            const next = { ...r };
            if (Object.keys(bag).length) next.__style = bag; else delete next.__style;
            return next;
          });
          for (const [id, style] of patch) ops.push({ op: 'update', id, style });
        }
      }

      if (change.inserts && change.inserts.length) {
        const next = rows.slice();
        for (const ins of change.inserts) {
          const at = Math.max(0, Math.min(next.length, ins.index));
          next.splice(at, 0, ins.row);
          inverse.deletes.push(ins.row.id);
          const values = {};
          for (const c of d.columns) {
            const v = ins.row[c.key];
            if (v !== null && v !== undefined) values[c.key] = v;
          }
          ops.push({ op: 'insert', id: ins.row.id, sort: ins.sort ?? null, values });
        }
        rows = next;
      }

      if (change.deletes && change.deletes.length) {
        const gone = new Set(change.deletes);
        for (const id of change.deletes) {
          const i = index.get(id);
          if (i === undefined) continue;
          inverse.inserts.push({ index: i, row: rows[i], sort: rows[i].__sort ?? null });
          ops.push({ op: 'delete', id });
        }
        rows = rows.filter(r => !gone.has(r.id));
      }

      if (!ops.length) return d;
      queueMicrotask(() => enqueue(ops));
      if (undoable) {
        inverse.inserts.sort((a, b) => a.index - b.index);
        queueMicrotask(() => setHistory(h => ({
          undo: [...h.undo, { label: change.label || 'change', inverse }].slice(-UNDO_MAX), redo: [] })));
      }
      return { ...d, rows };
    });
  }, [enqueue]);

  const edit = useCallback(edits => apply({ edits, label: 'edit' }), [apply]);
  const clear = useCallback(cells =>
    apply({ edits: cells.map(c => ({ ...c, value: null })), label: 'clear' }), [apply]);
  const deleteRows = useCallback(ids => apply({ deletes: ids, label: 'delete rows' }), [apply]);

  /**
   * Format cells. `cells` are {id, key} pairs — key may be the row marker — and `patch` is the
   * difference to make: { bg: 'yellow' } to fill, { bg: null } to clear the fill, { b: 1 } to
   * embolden. Everything is resolved against what each cell already wears, so bolding a mixed
   * selection bolds all of it rather than replacing what was there.
   */
  const setFormat = useCallback((cells, patch) => {
    const byId = new Map(dataRef.current.rows.map(r => [r.id, r]));
    const styles = [];
    for (const c of cells) {
      const row = byId.get(c.id);
      if (!row) continue;
      styles.push({ id: c.id, key: c.key,
                    style: mergeStyle((row.__style && row.__style[c.key]) || null, patch) });
    }
    if (styles.length) apply({ styles, label: 'format' });
  }, [apply]);

  /** Strip every mark from these cells. */
  const clearFormat = useCallback(cells => {
    if (cells.length) apply({ styles: cells.map(c => ({ id: c.id, key: c.key, style: null })),
                              label: 'clear formatting' });
  }, [apply]);

  /**
   * New rows, placed relative to a row the user pointed at rather than to a position.
   *
   * The grid's indices are into what it is showing — sorted, filtered, searched — and those are
   * not the stored order. Passing an index would put "insert below this row" somewhere else
   * entirely the moment a sort was applied, so the caller names the row and this finds it.
   *
   * @param {string|null} anchorId  the row to sit after (or before); null means the end
   */
  const insertRows = useCallback((anchorId, count = 1, seeds, where = 'after') => {
    setData(d => {
      const hasPlace = d.columns.some(c => c.key === 'place');
      const top = hasPlace ? d.rows.reduce((m, r) => (typeof r.place === 'number' && r.place > m ? r.place : m), 0) : 0;
      const found = anchorId ? d.rows.findIndex(r => r.id === anchorId) : -1;
      const start = found < 0 ? d.rows.length : (where === 'before' ? found : found + 1);
      // Appending past the last row has no row after it to sit before, so it counts on from the
      // last one rather than landing on zero and sorting to the top.
      const tail = d.rows.length ? (d.rows[d.rows.length - 1].__sort ?? d.rows.length) : 0;
      const inserts = [];
      for (let i = 0; i < count; i++) {
        const at = start + i;
        // A new row on a board gets the next rank, because a board row without one is not
        // something anybody can save.
        const raw = (seeds && seeds[i]) || (hasPlace ? { place: top + 1 + i } : {});
        // A seed arrives as text — from a file, a paste, or a review table — so it is read the
        // way the column means it before it becomes a row.
        const seed = {};
        for (const c of d.columns) if (raw[c.key] !== undefined) seed[c.key] = coerce(c, raw[c.key]);
        const sort = at >= d.rows.length
          ? tail + 1 + i
          : sortBetween(d.rows[at - 1] && d.rows[at - 1].__sort, d.rows[at].__sort);
        inserts.push({ index: at, row: { ...blankRow(d.columns, newRowId(), seed), __sort: sort }, sort });
      }
      queueMicrotask(() => apply({ inserts, label: 'add rows' }));
      return d;
    });
  }, [apply]);

  const duplicateRows = useCallback(ids => {
    setData(d => {
      const index = new Map(d.rows.map((r, i) => [r.id, i]));
      const inserts = [];
      let offset = 1;
      for (const id of ids) {
        const i = index.get(id);
        if (i === undefined) continue;
        const sort = sortBetween(d.rows[i].__sort, d.rows[i + 1] && d.rows[i + 1].__sort);
        const copy = { ...d.rows[i], id: newRowId(), __sort: sort };
        if (typeof copy.place === 'number') copy.place += offset;
        inserts.push({ index: i + offset, row: copy, sort });
        offset++;
      }
      if (inserts.length) queueMicrotask(() => apply({ inserts, label: 'duplicate rows' }));
      return d;
    });
  }, [apply]);

  /**
   * A pasted block. It writes into the rows it lands on and creates the ones it runs past, so
   * pasting a month's worth of names into an empty board is one gesture and one request.
   */
  const paste = useCallback(({ targetIds, columnKeys, matrix }) => {
    setData(d => {
      const byKey = new Map(d.columns.map(c => [c.key, c]));
      const edits = [], inserts = [];
      matrix.forEach((line, r) => {
        const values = {};
        line.forEach((text, c) => {
          const col = byKey.get(columnKeys[c]);
          if (!col || col.readOnly) return;
          values[col.key] = text;
        });
        if (!Object.keys(values).length) return;
        const id = targetIds[r];
        if (id) {
          for (const [k, v] of Object.entries(values)) edits.push({ id, key: k, value: v });
        } else {
          // The block ran past the last row, so the rest of it becomes rows. That is what makes
          // pasting a whole month into an empty board one gesture.
          const row = blankRow(d.columns, newRowId());
          for (const [k, v] of Object.entries(values)) row[k] = coerce(byKey.get(k), v);
          const tail = d.rows.length ? (d.rows[d.rows.length - 1].__sort ?? d.rows.length) : 0;
          const sort = tail + 1 + inserts.length;
          inserts.push({ index: d.rows.length + inserts.length, row: { ...row, __sort: sort }, sort });
        }
      });
      if (edits.length || inserts.length)
        queueMicrotask(() => apply({ edits, inserts,
          label: `paste ${matrix.length} row${matrix.length > 1 ? 's' : ''}` }));
      return d;
    });
  }, [apply]);

  // ---- columns and layout --------------------------------------------------------------------------
  const addColumn = useCallback(header => {
    const name = String(header || '').trim();
    if (!name) return;
    setData(d => {
      if (d.columns.some(c => c.header === name)) return d;
      const columns = [...d.columns, { key: 'x:' + name, header: name, type: 'text', width: 140, role: 'extra' }];
      queueMicrotask(() => enqueue([{ op: 'columns', columns: columns.map(c => c.header) }]));
      return { ...d, columns };
    });
  }, [enqueue]);

  const renameColumn = useCallback((key, to) => {
    const name = String(to || '').trim();
    if (!name) return;
    setData(d => {
      const col = d.columns.find(c => c.key === key);
      if (!col || col.header === name || d.columns.some(c => c.header === name)) return d;
      const nextKey = isExtra(col.key) ? 'x:' + name : col.key;
      const columns = d.columns.map(c => (c.key === key ? { ...c, header: name, key: nextKey } : c));
      const rows = isExtra(col.key)
        ? d.rows.map(r => { const { [col.key]: v, ...rest } = r; return { ...rest, [nextKey]: v ?? null }; })
        : d.rows;
      queueMicrotask(() => enqueue([{ op: 'columns', columns: columns.map(c => c.header),
                                      rename: { from: col.header, to: name } }]));
      return { ...d, columns, rows };
    });
  }, [enqueue]);

  const removeColumn = useCallback(key => {
    setData(d => {
      const col = d.columns.find(c => c.key === key);
      if (!col || col.role !== 'extra') return d;
      const columns = d.columns.filter(c => c.key !== key);
      queueMicrotask(() => enqueue([{ op: 'columns', columns: columns.map(c => c.header) }]));
      return { ...d, columns };
    });
  }, [enqueue]);

  const saveLayout = useCallback(columns => {
    enqueue([{ op: 'layout', layout: {
      widths: Object.fromEntries(columns.map(c => [c.key, c.width])),
      hidden: columns.filter(c => c.hidden).map(c => c.key),
      order: columns.map(c => c.key),
    } }]);
  }, [enqueue]);

  const setLayout = useCallback(fn => {
    setData(d => {
      const columns = fn(d.columns);
      queueMicrotask(() => saveLayout(columns));
      return { ...d, columns };
    });
  }, [saveLayout]);

  // A drag resizes many times a second; only where it stops is worth a save.
  const resizeColumn = useCallback((key, width) =>
    setData(d => ({ ...d, columns: d.columns.map(c => (c.key === key ? { ...c, width } : c)) })), []);
  const commitWidths = useCallback(() => setData(d => { queueMicrotask(() => saveLayout(d.columns)); return d; }), [saveLayout]);
  const toggleColumn = useCallback(key =>
    setLayout(cols => cols.map(c => (c.key === key ? { ...c, hidden: !c.hidden } : c))), [setLayout]);
  const showAllColumns = useCallback(() => setLayout(cols => cols.map(c => ({ ...c, hidden: false }))), [setLayout]);
  const moveColumn = useCallback((key, to) => setLayout(cols => {
    const from = cols.findIndex(c => c.key === key);
    if (from < 0 || from === to) return cols;
    const next = cols.slice();
    const [col] = next.splice(from, 1);
    next.splice(to, 0, col);
    return next;
  }), [setLayout]);

  // ---- undo -----------------------------------------------------------------------------------------
  const step = useCallback((from, to) => {
    setHistory(h => {
      const last = h[from][h[from].length - 1];
      if (!last) return h;
      const back = { edits: [], inserts: [], deletes: [], styles: [] };
      const rows = dataRef.current.rows;
      const index = new Map(rows.map((r, i) => [r.id, i]));
      for (const e of last.inverse.edits) {
        const i = index.get(e.id);
        if (i !== undefined) back.edits.push({ id: e.id, key: e.key, value: rows[i][e.key] ?? null });
      }
      for (const st of last.inverse.styles || []) {
        const i = index.get(st.id);
        if (i !== undefined)
          back.styles.push({ id: st.id, key: st.key,
                             style: (rows[i].__style && rows[i].__style[st.key]) || null });
      }
      for (const id of last.inverse.deletes) {
        const i = index.get(id);
        if (i !== undefined) back.inserts.push({ index: i, row: rows[i], sort: null });
      }
      for (const ins of last.inverse.inserts) back.deletes.push(ins.row.id);
      queueMicrotask(() => apply({ ...last.inverse, label: from }, { undoable: false }));
      return { ...h, [from]: h[from].slice(0, -1), [to]: [...h[to], { label: last.label, inverse: back }] };
    });
  }, [apply]);

  const undo = useCallback(() => step('undo', 'redo'), [step]);
  const redo = useCallback(() => step('redo', 'undo'), [step]);

  // ---- drafts ------------------------------------------------------------------------------------------
  const restoreDraft = useCallback(() => {
    if (!draft) return;
    enqueue(draft.ops);
    setDraft(null);
    if (notify) notify(`${draft.ops.length} unsaved change${draft.ops.length > 1 ? 's' : ''} put back.`);
  }, [draft, enqueue, notify]);
  const discardDraft = useCallback(() => { store.del(draftKey(key)); setDraft(null); }, [key]);

  return {
    key, ...data, loading, error,
    save, rejected, draft,
    reload: load, flush: flushNow, resolveConflict, restoreDraft, discardDraft,
    edit, clear, paste, insertRows, duplicateRows, deleteRows, setFormat, clearFormat,
    addColumn, renameColumn, removeColumn, toggleColumn, showAllColumns,
    moveColumn, resizeColumn, commitWidths,
    undo, redo, canUndo: history.undo.length > 0, canRedo: history.redo.length > 0,
  };
}
