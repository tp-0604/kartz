/**
 * DATA — where everything the extractor produced is looked at, searched, corrected and asked
 * questions of.
 *
 * It holds the shape of the view (which dataset, which filters, which sort) and hands the rows
 * to the grid. The rows themselves, and what an edit means, belong to useDataset; what a cell
 * looks like belongs to DataGrid; what a question means belongs to the Worker. This file is the
 * place those three meet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { useDataset, cellId } from '../data/useDataset.js';
import { problems, shape } from '../data/model.js';
import DataGrid from '../grid/DataGrid.jsx';
import DatasetNav, { VIEWS } from './DatasetNav.jsx';
import Toolbar from './Toolbar.jsx';
import ImportDialog from './ImportDialog.jsx';
import BoardBar from './BoardBar.jsx';
import MonthView from './views/MonthView.jsx';
import PlayerView from './views/PlayerView.jsx';
import RunsView from './views/RunsView.jsx';
import ActivityView from './views/ActivityView.jsx';
import AskBar from '../ai/AskBar.jsx';
import AnalysisPanel from '../ai/AnalysisPanel.jsx';
import { useAnalyst } from '../ai/useAnalyst.js';
import Boundary from '../components/shared/Boundary.jsx';
import { exportDataset } from '../services/exporter.js';
import * as API from '../services/api.js';
import { deleteBoard } from '../services/api.js';
import { fmtTime } from '../utils/format.js';
import { store } from '../utils/storage.js';

const SAVE_TEXT = {
  saved:    ['', 'Saved'],
  dirty:    ['dirty', 'Unsaved changes'],
  saving:   ['dirty', 'Saving…'],
  partial:  ['bad', 'Some cells not saved'],
  failed:   ['bad', 'Save failed'],
  conflict: ['bad', 'Someone else saved this'],
};

export default function DataWorkspace({ active }) {
  const { datasets, refreshDatasets, notify, openTarget, setOpenTarget, boards } = useApp();
  const [target, setTarget] = useState(() => openTarget || { kind: 'dataset', key: store.get('ws.open') || 'roster' });
  const [filters, setFilters] = useState([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(null);
  const [selection, setSelection] = useState(null);
  const [importing, setImporting] = useState(false);
  const [railOff, setRailOff] = useState(() => !!store.get('ws.railOff'));
  const analyst = useAnalyst();
  const [panelW, setPanelW] = useState(() => store.get('ws.panelW') || 400);
  const findRef = useRef(null);
  const gridWrap = useRef(null);

  // The command palette and the extractor both open things here.
  useEffect(() => {
    if (!openTarget) return;
    setTarget(openTarget);
    setOpenTarget(null);
  }, [openTarget, setOpenTarget]);

  const datasetKey = target.kind === 'dataset' ? target.key : null;
  const ds = useDataset(datasetKey, { notify, onSaved: () => refreshDatasets() });

  useEffect(() => {
    if (datasetKey) store.set('ws.open', datasetKey);
    setFilters([]); setQuery(''); setSort(null); setSelection(null);
  }, [datasetKey]);

  // ---- what the grid actually shows -----------------------------------------------------------
  const visibleColumns = useMemo(() => ds.columns.filter(c => !c.hidden), [ds.columns]);
  const rows = useMemo(() => shape(ds.rows, ds.columns, { filters, query, sort }),
                       [ds.rows, ds.columns, filters, query, sort]);
  const issues = useMemo(
    () => (ds.dataset ? problems(ds.dataset.kind, ds.rows) : []), [ds.dataset, ds.rows]);

  const findHit = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (row, col) => String(row[col.key] ?? '').toLowerCase().includes(q);
  }, [query]);

  const rowFlags = useCallback(row => {
    if (!ds.rejected.size && !row.edited) return null;
    const unsaved = new Set();
    for (const c of ds.columns) if (ds.rejected.has(cellId(row.id, c.key))) unsaved.add(c.key);
    return { edited: !!row.edited, unsaved };
  }, [ds.rejected, ds.columns]);

  // ---- actions ----------------------------------------------------------------------------------
  // Where a new row goes is named by the row it follows, not by a number: the grid's positions
  // are into what it is showing, which a sort or a filter has already rearranged.
  const addRow = useCallback(() => {
    const after = selection && rows[selection.r1] ? rows[selection.r1].id : null;
    ds.insertRows(after, 1);
  }, [ds, selection, rows]);

  const doExport = useCallback(async (format, scope) => {
    const set = scope === 'all' ? ds.rows
      : scope === 'selected' ? ds.rows.filter(r => selection && selection.rowIds.includes(r.id))
      : rows;
    if (!set.length) { notify('There is nothing to export.', 'warn'); return; }
    await exportDataset({ format, columns: ds.columns, rows: set,
                          name: ds.dataset ? ds.dataset.title : 'kartz' });
    notify(`Exported ${set.length.toLocaleString()} rows ✓`);
  }, [ds.rows, ds.columns, ds.dataset, rows, selection, notify]);

  /**
   * A table brought in from somewhere else. Appending goes through the same operations a paste
   * does, so it is one batch and it can be undone; replacing is a whole-dataset write, which is
   * a different thing and says so before it happens.
   */
  const importRows = useCallback(async ({ rows: incoming, newColumns, mode }) => {
    for (const h of newColumns) ds.addColumn(h);
    if (mode === 'append') {
      await new Promise(r => setTimeout(r, 0));          // let the columns exist first
      ds.insertRows(null, incoming.length, incoming);
      return;
    }
    const kind = ds.dataset.kind;
    const columns = [...ds.columns.map(c => c.header), ...newColumns.filter(h => !ds.columns.some(c => c.header === h))];
    const records = incoming.map(r => {
      const extra = {};
      for (const [k, v] of Object.entries(r)) if (k.startsWith('x:') && v) extra[k.slice(2)] = v;
      return kind === 'roster'
        ? { search: r.search, ingame: r.ingame || r.search, alliance: r.alliance, extra }
        : { place: r.place, search: r.search, ingame: r.ingame, alliance: r.alliance,
            points: r.points, extra };
    });
    if (kind === 'roster') {
      await API.saveRoster({ rows: records, columns, version: ds.version,
                             mapping: ds.dataset.mapping, allowEmpty: !records.length });
    } else {
      await API.saveBoard(ds.dataset.id, { rows: records, columns, version: ds.version });
    }
    await ds.reload();
  }, [ds]);

  const removeBoard = useCallback(async () => {
    if (!ds.dataset || ds.dataset.kind !== 'board') return;
    if (!window.confirm(`Delete the ${ds.dataset.alliance} board from ${ds.dataset.date}, and its `
      + `${ds.rows.length} rows?\n\nThis cannot be undone.`)) return;
    try {
      await deleteBoard(ds.dataset.id);
      notify('Board deleted.');
      await refreshDatasets();
      setTarget({ kind: 'dataset', key: 'roster' });
    } catch (e) { notify('Could not delete it: ' + e.message, 'bad'); }
  }, [ds.dataset, ds.rows.length, notify, refreshDatasets]);

  // ---- keyboard that belongs to the workspace rather than the grid -----------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = e => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); findRef.current && findRef.current.focus(); findRef.current.select(); }
      else if (k === 's') { e.preventDefault(); ds.flush(); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); ds.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); ds.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, ds]);

  // ---- what the analyst is told about this screen -------------------------------------------------
  const aiContext = useMemo(() => {
    if (!ds.dataset) return null;
    return {
      dataset: ds.dataset.kind === 'roster' ? 'roster' : 'board:' + ds.dataset.id,
      describes: ds.dataset.kind === 'roster' ? 'the roster'
        : `${ds.dataset.alliance} on ${ds.dataset.date}${ds.dataset.label ? ' (' + ds.dataset.label + ')' : ''}`,
      totalRows: ds.rows.length,
      filters: filters.filter(f => f.key).map(f => ({ field: f.key, op: f.op, value: f.value })),
      search: query || null,
      rowsAfterFilters: rows.length,
      sort: sort ? { field: sort.key, direction: sort.dir } : null,
      visibleColumns: visibleColumns.map(c => c.key),
      selectedRows: selection ? selection.rowIds.length : 0,
    };
  }, [ds.dataset, ds.rows.length, filters, query, rows.length, sort, visibleColumns, selection]);

  const onAnalysisSource = useCallback(source => {
    // "View source data" — take the workspace to the rows the answer was computed from.
    if (!source || !source.dataset) return;
    if (source.dataset.startsWith('board:') || source.dataset === 'roster') {
      setTarget({ kind: 'dataset', key: source.dataset });
      if (Array.isArray(source.filters) && source.filters.length)
        setFilters(source.filters.filter(f => f && f.field)
          .map(f => ({ key: f.field, op: f.op || 'eq', value: f.value })));
    } else if (source.dataset.startsWith('month:')) {
      setTarget({ kind: 'view', id: 'month' });
    }
  }, []);

  // ---- the panel's width, dragged ------------------------------------------------------------------
  const startDragPanel = e => {
    e.preventDefault();
    const startX = e.clientX, startW = panelW;
    const move = ev => setPanelW(Math.max(300, Math.min(760, startW - (ev.clientX - startX))));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setPanelW(w => { store.set('ws.panelW', w); return w; });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const view = target.kind === 'view' ? VIEWS.find(v => v.id === target.id) : null;
  const [saveClass, saveLabel] = SAVE_TEXT[ds.save.status] || SAVE_TEXT.saved;

  return (
    <div className={'ws' + (railOff ? ' is-railed-off' : '') + (analyst.state ? ' has-panel' : '')}>
      <DatasetNav datasets={datasets} current={target.kind === 'dataset' ? target.key : 'view:' + target.id}
                  onOpen={setTarget} onImport={() => setImporting(true)}
                  onNewBoard={() => setImporting('board')} />

      <div className="ws__main">
        <div className="ws__head">
          <button className="btn btn--sm btn--icon btn--quiet" title={railOff ? 'Show the list' : 'Hide the list'}
                  onClick={() => setRailOff(v => { store.set('ws.railOff', !v); return !v; })}>
            {railOff ? '»' : '«'}
          </button>

          {view ? (
            <div className="ws__title"><h1>{view.label}</h1></div>
          ) : (
            <BoardBar dataset={ds.dataset} version={ds.version} rows={ds.rows.length}
                      onChanged={async () => { await refreshDatasets(); ds.reload(); }}
                      onRenamed={key => setTarget({ kind: 'dataset', key })}
                      boards={boards} />
          )}

          <AskBar analyst={analyst} context={aiContext} />

          {!view && (
            <span className={'ws__savestate' + (saveClass ? ' is-' + saveClass : '')}
                  title={ds.save.error || (ds.save.at ? 'last saved ' + fmtTime(ds.save.at) : '')}>
              <i className={'dot' + (saveClass === 'bad' ? ' dot--bad' : saveClass === 'dirty' ? ' dot--dirty' : '')} />
              {saveLabel}
              {ds.save.status === 'failed' && (
                <button className="btn btn--sm" style={{ marginLeft: 6 }} onClick={ds.flush}>Retry</button>
              )}
            </span>
          )}
        </div>

        {view ? (
          <div className="ws__fill">
            {view.id === 'month' ? <MonthView />
              : view.id === 'player' ? <PlayerView />
              : view.id === 'runs' ? <RunsView onOpen={key => setTarget({ kind: 'dataset', key })} />
              : <ActivityView onOpen={key => setTarget({ kind: 'dataset', key })} />}
          </div>
        ) : (
          <>
            <Toolbar
              columns={ds.columns} rows={{ total: ds.rows.length, shown: rows.length,
                                           selected: selection ? selection.rowIds.length : 0 }}
              filters={filters} setFilters={setFilters}
              query={query} setQuery={setQuery} matches={rows.length}
              sort={sort} setSort={setSort} findRef={findRef}
              onAddRow={addRow} onImport={() => setImporting(true)} onExport={doExport}
              onToggleColumn={ds.toggleColumn} onShowAllColumns={ds.showAllColumns}
              onAddColumn={ds.addColumn} onRenameColumn={ds.renameColumn} onRemoveColumn={ds.removeColumn}
              onUndo={ds.undo} onRedo={ds.redo} canUndo={ds.canUndo} canRedo={ds.canRedo}
              onReload={() => ds.reload()}
              onDelete={ds.dataset && ds.dataset.kind === 'board' ? removeBoard : null}
              readOnly={false} />

            <Notices ds={ds} issues={issues} />

            <div className="ws__fill" ref={gridWrap}>
              {ds.loading ? <div className="loading">Loading…</div>
                : ds.error ? <div className="ws__notice"><div className="note note--bad">{ds.error}</div></div>
                : (
                  <DataGrid
                    columns={ds.columns} rows={rows} rowHeight={30}
                    sort={sort}
                    onSortToggle={key => setSort(s => (s && s.key === key
                      ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }))}
                    onEdit={ds.edit} onClear={ds.clear}
                    onPaste={({ rowIndex, colIndex, matrix }) => ds.paste({
                      targetIds: rows.slice(rowIndex, rowIndex + matrix.length).map(r => r.id),
                      columnKeys: visibleColumns.slice(colIndex).map(c => c.key),
                      matrix,
                    })}
                    onAddRow={addRow}
                    onResize={(key, w) => ds.resizeColumn(key, w)}
                    onMoveColumn={ds.moveColumn}
                    onSelectionChange={setSelection}
                    rowFlags={rowFlags} findHit={findHit}
                    emptyText={query || filters.length
                      ? 'No row matches. Clear the search or the filters to see the rest.'
                      : 'Nothing here yet — add a row, import a spreadsheet, or extract a recording.'}
                    menuItems={({ rowIndex, column, selection: box }) => rowIndex < 0 ? [
                      { label: 'Sort ascending', run: () => setSort({ key: column.key, dir: 'asc' }) },
                      { label: 'Sort descending', run: () => setSort({ key: column.key, dir: 'desc' }) },
                      { label: 'Hide this column', run: () => ds.toggleColumn(column.key) },
                    ] : [
                      { label: 'Insert row above',
                        run: () => ds.insertRows(rows[box.r0] && rows[box.r0].id, 1, null, 'before') },
                      { label: 'Insert row below',
                        run: () => ds.insertRows(rows[box.r1] && rows[box.r1].id, 1) },
                      { label: box.r0 === box.r1 ? 'Duplicate row' : `Duplicate ${box.r1 - box.r0 + 1} rows`,
                        run: () => ds.duplicateRows(rows.slice(box.r0, box.r1 + 1).map(r => r.id)) },
                      { label: box.r0 === box.r1 ? 'Delete row' : `Delete ${box.r1 - box.r0 + 1} rows`,
                        run: () => ds.deleteRows(rows.slice(box.r0, box.r1 + 1).map(r => r.id)) },
                      { sep: true },
                      { label: `Filter by this value`, disabled: !column,
                        run: () => setFilters(f => [...f, { key: column.key, op: 'eq',
                          value: String(rows[box.r0][column.key] ?? '') }]) },
                      { label: 'Sort by this column', disabled: !column,
                        run: () => setSort({ key: column.key, dir: column.type === 'int' ? 'desc' : 'asc' }) },
                    ]}
                  />
                )}
            </div>

            <div className="ws__status">
              <span><b>{rows.length.toLocaleString()}</b>{rows.length === ds.rows.length ? '' : ` of ${ds.rows.length.toLocaleString()}`} rows</span>
              {selection && selection.rowIds.length > 1 && <span><b>{selection.rowIds.length}</b> selected</span>}
              {selection && selection.cells > 1 && <span><b>{selection.cells}</b> cells</span>}
              {filters.length > 0 && <span><b>{filters.length}</b> filter{filters.length > 1 ? 's' : ''} active</span>}
              {issues.length > 0 && (
                <span className="pill pill--warn" title={issues.slice(0, 6).map(p => p.text).join('\n')}>
                  {issues.length} to fix
                </span>
              )}
              <span className="spacer" />
              {ds.version !== null && <span>version {ds.version}</span>}
              {ds.save.at && <span>saved {fmtTime(ds.save.at)}</span>}
            </div>
          </>
        )}
      </div>

      {analyst.state && (
        <Boundary resetKey={analyst.state.history.length}
                  fallback={err => (
                    <aside className="aipanel" style={{ width: panelW }} aria-label="Analysis">
                      <div className="aipanel__grip" onMouseDown={startDragPanel} />
                      <div className="aipanel__head">
                        <h2>✦ Analysis</h2><span className="spacer" />
                        <button className="btn btn--sm btn--quiet" onClick={analyst.close}>✕</button>
                      </div>
                      <div className="aipanel__body">
                        <div className="note note--bad">That answer could not be drawn: {String(err && err.message || err)}</div>
                        <p className="hint">The grid, the extractor and every save are unaffected —
                          nothing outside this panel depends on it. Ask again, or close the panel.</p>
                      </div>
                    </aside>
                  )}>
          <AnalysisPanel state={analyst.state} status={analyst.status} width={panelW}
                         onDragStart={startDragPanel} onClose={analyst.close}
                         onAsk={q => analyst.ask(q, aiContext)} onSource={onAnalysisSource} />
        </Boundary>
      )}

      {importing && (
        <ImportDialog mode={importing === 'board' ? 'board' : 'file'}
                      dataset={ds.dataset} columns={ds.columns} onImportRows={importRows}
                      onClose={() => setImporting(false)}
                      onDone={async key => {
                        setImporting(false);
                        await refreshDatasets();
                        if (key) setTarget({ kind: 'dataset', key });
                        else ds.reload();
                      }} />
      )}
    </div>
  );
}

/** The things that have to be said before the rows can be trusted: a conflict, a draft, a failure. */
function Notices({ ds, issues }) {
  if (ds.save.status === 'conflict') {
    return (
      <div className="ws__notice">
        <div className="note note--bad">
          <div className="row">
            <span style={{ flex: 1 }}>
              <strong>Not saved.</strong> {ds.save.error} Your {ds.save.pending} change
              {ds.save.pending > 1 ? 's are' : ' is'} still here.
            </span>
            <button className="btn btn--sm" onClick={() => ds.resolveConflict(true)}>
              Take theirs, then re-apply mine
            </button>
            <button className="btn btn--sm btn--quiet" onClick={() => ds.resolveConflict(false)}>
              Throw mine away
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (ds.draft) {
    return (
      <div className="ws__notice">
        <div className="note note--warn">
          <div className="row">
            <span style={{ flex: 1 }}>
              {ds.draft.ops.length} change{ds.draft.ops.length > 1 ? 's' : ''} from {fmtTime(ds.draft.at)} never
              reached the database — this browser kept {ds.draft.ops.length > 1 ? 'them' : 'it'}.
            </span>
            <button className="btn btn--sm" onClick={ds.restoreDraft}>Put them back</button>
            <button className="btn btn--sm btn--quiet" onClick={ds.discardDraft}>Discard</button>
          </div>
        </div>
      </div>
    );
  }
  if (ds.save.status === 'failed') {
    return (
      <div className="ws__notice">
        <div className="note note--bad">
          <div className="row">
            <span style={{ flex: 1 }}><strong>Save failed.</strong> {ds.save.error} Nothing has been lost —
              the changes are still on screen and will go again when you press Retry.</span>
            <button className="btn btn--sm" onClick={ds.flush}>Retry</button>
          </div>
        </div>
      </div>
    );
  }
  if (issues.length) {
    return (
      <div className="ws__notice">
        <div className="note note--warn">
          {issues.length === 1 ? issues[0].text
            : <>{issues.length} rows need attention: {issues.slice(0, 3).map(p => p.text).join('; ')}
                {issues.length > 3 ? `; and ${issues.length - 3} more` : ''}.</>}
        </div>
      </div>
    );
  }
  return <div />;
}
