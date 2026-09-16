/**
 * The spreadsheet engine, created in a box and driven by four verbs: read what is there, write
 * new row ids into it, save the whole workbook, and say whether anything was changed.
 *
 * Nothing else in the app imports Univer, and this file is only ever loaded lazily: it is most of
 * the build by weight, and a phone opening the extractor should never pay for it.
 */
import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import CoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import SortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import FilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs/preset-sheets-sort/lib/index.css';
import '@univerjs/preset-sheets-filter/lib/index.css';

// What counts as the user changing something, for "close without saving?". The app's own writes
// happen before anything listens.
const CHANGES = /insert-row|remove-row|insert-col|remove-col|move-r|move-c|set-range-values|set-style|clear|paste|cut|delete-range|insert-range|set-worksheet-row|set-worksheet-col|add-merge|remove-merge|formula|numfmt|undo|redo/;

// The rows live on the first sheet. A tab somebody adds for their own working is theirs.
const firstSheet = api => api.getActiveWorkbook().getSheets()[0];

function fill(ws, block, widths) {
  const width = Math.max(1, ...block.map(line => line.length));
  const lines = block.map(line => Array.from({ length: width }, (_, i) => line[i] ?? ''));
  const rowsNeeded = lines.length + 50;
  if (ws.getMaxRows() < rowsNeeded) ws.insertRows(ws.getMaxRows(), rowsNeeded - ws.getMaxRows());
  const colsNeeded = width + 5;
  if (ws.getMaxColumns() < colsNeeded) ws.insertColumns(ws.getMaxColumns(), colsNeeded - ws.getMaxColumns());
  ws.getRange(0, 0, lines.length, width).setValues(lines);
  ws.getRange(0, 0, 1, width).setFontWeight('bold');
  widths.forEach((w, i) => { if (w) ws.setColumnWidths(i + 1, 1, w); });
  ws.setFrozenRows(1);
  ws.hideColumns(0, 1);
}

function read(ws) {
  const lastRow = ws.getLastRow(), lastCol = ws.getLastColumn();
  if (lastRow < 0 || lastCol < 0) return [];
  return ws.getRange(0, 0, lastRow + 1, lastCol + 1).getValues();
}

export default function SpreadsheetEditor({ block, widths, workbook, onReady }) {
  const host = useRef(null);
  useEffect(() => {
    // StrictMode mounts twice in development and Univer measures its container once, so it is
    // created a tick later and the first, discarded mount never creates anything at all.
    let alive = true, univerAPI = null, subs = [];
    const t = setTimeout(() => {
      if (!alive || !host.current) return;
      ({ univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(CoreEnUS, SortEnUS, FilterEnUS) },
        presets: [
          UniverSheetsCorePreset({ container: host.current }),
          UniverSheetsSortPreset(),
          UniverSheetsFilterPreset(),
        ],
      }));
      if (workbook) {
        univerAPI.createWorkbook(workbook);
      } else {
        univerAPI.createWorkbook({ id: 'kartz', name: 'Kartz' });
        fill(firstSheet(univerAPI), block, widths);
      }
      let dirty = false;
      subs = [univerAPI.addEvent(univerAPI.Event.CommandExecuted, ({ id }) => {
        if (CHANGES.test(id)) dirty = true;
      })];
      onReady({
        read: () => read(firstSheet(univerAPI)),
        writeIds: pairs => {
          const ws = firstSheet(univerAPI);
          for (const { line, id } of pairs) ws.getRange(line, 0, 1, 1).setValues([[id]]);
        },
        snapshot: () => univerAPI.getActiveWorkbook().save(),
        isDirty: () => dirty,
      });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
      subs.forEach(s => s && s.dispose && s.dispose());
      if (univerAPI) { onReady(null); univerAPI.dispose(); }
    };
  }, []);
  return <div ref={host} className="sheetdlg__host" />;
}
