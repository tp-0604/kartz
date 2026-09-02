// Everything the app needs from the workbook, behind five verbs. Nothing outside this file
// and SheetWorkspace.jsx imports Univer, so a change of library is a change here.
import { COLUMNS, HEADER_ROW, toSheetRows, fromSheetRows } from './columns.js';

const HEADER_BG = '#e2efee';
const HEADER_INK = '#1f5f5a';

export function createSheetController(univerAPI) {
  let dirty = false;
  let muted = 0;                       // >0 while the app itself is writing
  const listeners = new Set();
  const setDirty = v => { if (dirty === v) return; dirty = v; listeners.forEach(fn => fn(v)); };
  const changed = () => { if (!muted) setDirty(true); };

  // Anything that changes values or structure marks the workbook dirty. Undo is a change too.
  const subs = [
    univerAPI.addEvent(univerAPI.Event.SheetValueChanged, changed),
    univerAPI.addEvent(univerAPI.Event.CommandExecuted, ({ id }) => {
      if (/insert-row|remove-row|insert-col|remove-col|move-r|move-c|set-range-values|set-style|clear|paste|cut|delete-range|insert-range|set-worksheet-row|set-worksheet-col|add-merge|remove-merge|undo|redo/.test(id))
        changed();
    }),
  ];

  const workbook = () => univerAPI.getActiveWorkbook();
  const sheet = () => workbook().getActiveSheet();

  // The app writes in one go and does not want its own writes counted as the user's.
  const quietly = fn => { muted++; try { return fn(); } finally { muted--; } };

  function ensureRows(ws, need) {
    const have = ws.getMaxRows();
    if (need > have) ws.insertRows(have, need - have + 5);
  }

  function decorate(ws, nRows, columns) {
    const head = ws.getRange(HEADER_ROW, 0, 1, columns.length);
    head.setFontWeight('bold').setBackgroundColor(HEADER_BG).setFontColor(HEADER_INK);
    columns.forEach((c, i) => {
      if (c.width) ws.setColumnWidths(i, 1, c.width);
      if (c.numberFormat && nRows > 0)
        ws.getRange(HEADER_ROW + 1, i, nRows, 1).setNumberFormat(c.numberFormat);
    });
    ws.setFrozenRows(HEADER_ROW + 1);
  }

  return {
    /** Replace the sheet with these records: header, values, widths, formats, frozen header. */
    loadRows(records, columns = COLUMNS) {
      quietly(() => {
        const ws = sheet();
        ws.clear();
        const values = [columns.map(c => c.header), ...toSheetRows(records, columns)];
        ensureRows(ws, values.length + 20);
        ws.getRange(HEADER_ROW, 0, values.length, columns.length).setValues(values);
        decorate(ws, values.length - 1, columns);
        ws.getRange(HEADER_ROW + 1, 0).activate();
      });
      setDirty(false);
    },

    /**
     * Replace the sheet with a raw block: the first row is the header. Used where the columns
     * are not fixed in code — the roster's are whatever its own heading row says.
     */
    loadValues(values, columns) {
      quietly(() => {
        const ws = sheet();
        ws.clear();
        const width = Math.max(1, ...values.map(r => r.length));
        ensureRows(ws, values.length + 40);
        // Format before value, or the sheet decides for itself what a cell of digits is.
        (columns || []).forEach((c, i) => {
          if (c.numberFormat) ws.getRange(HEADER_ROW + 1, i, values.length + 40, 1).setNumberFormat(c.numberFormat);
        });
        if (values.length) ws.getRange(HEADER_ROW, 0, values.length, width).setValues(values);
        const head = ws.getRange(HEADER_ROW, 0, 1, width);
        head.setFontWeight('bold').setBackgroundColor(HEADER_BG).setFontColor(HEADER_INK);
        (columns || []).forEach((c, i) => { if (c.width) ws.setColumnWidths(i, 1, c.width); });
        ws.setFrozenRows(HEADER_ROW + 1);
        ws.getRange(HEADER_ROW + 1, 0).activate();
      });
      setDirty(false);
    },

    /** The sheet as a raw block, header row included. */
    readValues() {
      const ws = sheet();
      const lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
      if (lastRow < 0 || lastCol < 0) return [];
      return ws.getRange(HEADER_ROW, 0, lastRow + 1, lastCol + 1).getValues();
    },

    /** Append below whatever is there. A second recording in one sitting, say. */
    appendRows(records, columns = COLUMNS) {
      quietly(() => {
        const ws = sheet();
        const start = Math.max(HEADER_ROW + 1, ws.getLastRow() + 1);
        const values = toSheetRows(records, columns);
        ensureRows(ws, start + values.length + 20);
        ws.getRange(start, 0, values.length, columns.length).setValues(values);
        columns.forEach((c, i) => {
          if (c.numberFormat) ws.getRange(start, i, values.length, 1).setNumberFormat(c.numberFormat);
        });
      });
      setDirty(true);
    },

    /** The fixed columns, as records, for the Worker. */
    readRows(columns = COLUMNS) {
      const ws = sheet();
      const last = ws.getLastRow();
      if (last < HEADER_ROW + 1) return [];
      const values = ws.getRange(HEADER_ROW, 0, last + 1, columns.length).getValues();
      return fromSheetRows(values, columns);
    },

    /** The whole workbook, formatting and formulas included, as JSON. */
    snapshot() { return workbook().save(); },

    /** Restore a saved workbook in place of the current one. */
    restore(data) {
      quietly(() => {
        const cur = workbook();
        if (cur) univerAPI.disposeUnit(cur.getId());
        univerAPI.createWorkbook(data);
      });
      setDirty(false);
    },

    /** Start again with an empty workbook carrying just the header. */
    reset(columns = COLUMNS) { this.loadRows([], columns); },

    undo: () => univerAPI.undo(),
    redo: () => univerAPI.redo(),
    isDirty: () => dirty,
    markClean: () => setDirty(false),
    markDirty: () => setDirty(true),
    onDirty(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { subs.forEach(s => s && s.dispose && s.dispose()); listeners.clear(); },
  };
}
