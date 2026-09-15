/**
 * The bar above the grid.
 *
 * Everything a person reaches for several times an hour is a button here; everything else is
 * behind one of three menus or the command palette. It stays on one line at any sensible width,
 * because a toolbar that wraps to three rows has taken thirty rows of data with it.
 */
import { useState } from 'react';
import Dropdown from '../components/shared/Dropdown.jsx';
import { FILTER_OPS } from '../data/model.js';
import FormatMenu from './FormatMenu.jsx';

const MODKEY = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl+';

export default function Toolbar({
  columns, rows, filters, setFilters, query, setQuery, matches, sort, setSort,
  onAddRow, onImport, onExport, onToggleColumn, onShowAllColumns, onAddColumn, onRenameColumn,
  onRemoveColumn, onUndo, onRedo, canUndo, canRedo, onReload, onDelete, readOnly, extra,
  findRef, format, renameAny,
}) {
  const hidden = columns.filter(c => c.hidden).length;
  const visible = columns.filter(c => !c.hidden);

  return (
    <div className="ws__tools">
      <div className="findbox">
        <span className="findbox__icon">⌕</span>
        <input ref={findRef} value={query} onChange={e => setQuery(e.target.value)}
               placeholder="Search rows…" spellCheck={false} aria-label="Search rows"
               onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }} />
        {query && <span className="findbox__n">{matches.toLocaleString()}</span>}
      </div>

      <FilterMenu columns={columns} filters={filters} setFilters={setFilters} rows={rows} />

      <Dropdown label={sort ? `Sort · ${labelOf(columns, sort.key)}` : 'Sort'} width={240}
                className={'btn btn--sm' + (sort ? ' is-on' : '')}>
        {close => (
          <>
            <div className="menu__head">Sort by</div>
            {visible.map(c => (
              <button key={c.key} type="button" className="menu__item"
                      onClick={() => { setSort(s => (s && s.key === c.key
                        ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' })); close(); }}>
                <span>{c.header}</span>
                {sort && sort.key === c.key && <span className="menu__hint">{sort.dir === 'asc' ? 'A→Z' : 'Z→A'}</span>}
              </button>
            ))}
            <hr className="menu__sep" />
            <button type="button" className="menu__item" disabled={!sort}
                    onClick={() => { setSort(null); close(); }}>
              <span>Back to the stored order</span>
            </button>
          </>
        )}
      </Dropdown>

      <Dropdown label={hidden ? `Columns · ${visible.length}/${columns.length}` : 'Columns'} width={290}
                className={'btn btn--sm' + (hidden ? ' is-on' : '')}>
        {close => (
          <ColumnsMenu columns={columns} readOnly={readOnly} close={close} renameAny={renameAny}
                       onToggleColumn={onToggleColumn} onShowAllColumns={onShowAllColumns}
                       onAddColumn={onAddColumn} onRenameColumn={onRenameColumn}
                       onRemoveColumn={onRemoveColumn} />
        )}
      </Dropdown>

      <div className="ws__sep" />

      {format && (
        <>
          <FormatMenu {...format} disabled={readOnly || !format.cells} />
          <div className="ws__sep" />
        </>
      )}

      <button className="btn btn--sm" onClick={() => onAddRow()} disabled={readOnly}
              title={`Add a row (Alt+Enter)`}>+ Row</button>

      <Dropdown label="Export" width={250} align="right">
        {close => (
          <>
            <div className="menu__head">Download</div>
            <button type="button" className="menu__item" onClick={() => { onExport('csv', 'view'); close(); }}>
              <span>What is on screen, as CSV</span></button>
            <button type="button" className="menu__item" onClick={() => { onExport('xlsx', 'view'); close(); }}>
              <span>What is on screen, as XLSX</span></button>
            <hr className="menu__sep" />
            <button type="button" className="menu__item" onClick={() => { onExport('csv', 'all'); close(); }}>
              <span>Every row, as CSV</span><span className="menu__hint">{rows.total}</span></button>
            <button type="button" className="menu__item" onClick={() => { onExport('xlsx', 'all'); close(); }}>
              <span>Every row, as XLSX</span></button>
            <hr className="menu__sep" />
            <button type="button" className="menu__item" disabled={!rows.selected}
                    onClick={() => { onExport('csv', 'selected'); close(); }}>
              <span>Selected rows, as CSV</span><span className="menu__hint">{rows.selected || 0}</span></button>
          </>
        )}
      </Dropdown>

      <div className="spacer" />
      {extra}

      <button className="btn btn--sm btn--icon" title={`Undo (${MODKEY}Z)`} onClick={onUndo} disabled={!canUndo}>↶</button>
      <button className="btn btn--sm btn--icon" title={`Redo (${MODKEY}⇧Z)`} onClick={onRedo} disabled={!canRedo}>↷</button>

      <Dropdown label="⋯" className="btn btn--sm btn--icon" width={260} align="right" title="More">
        {close => (
          <>
            <button type="button" className="menu__item" onClick={() => { onImport(); close(); }}>
              <span>Import a spreadsheet…</span></button>
            <button type="button" className="menu__item" onClick={() => { onReload(); close(); }}>
              <span>Reload from the database</span></button>
            <hr className="menu__sep" />
            <button type="button" className="menu__item" disabled={!onDelete}
                    onClick={() => { onDelete && onDelete(); close(); }}>
              <span>Delete this board…</span></button>
          </>
        )}
      </Dropdown>
    </div>
  );
}

const labelOf = (columns, key) => (columns.find(c => c.key === key) || {}).header || key;

function ColumnsMenu({ columns, readOnly, close, renameAny, onToggleColumn, onShowAllColumns,
                       onAddColumn, onRenameColumn, onRemoveColumn }) {
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState(null);
  return (
    <>
      <div className="menu__head">Shown</div>
      {columns.map(c => (
        <div key={c.key} className="menu__item" style={{ cursor: 'default' }}>
          {renaming === c.key ? (
            <input autoFocus defaultValue={c.header} className="input--sm" style={{ height: 24 }}
                   onKeyDown={e => {
                     if (e.key === 'Enter') { onRenameColumn(c.key, e.currentTarget.value); setRenaming(null); }
                     if (e.key === 'Escape') setRenaming(null);
                   }}
                   onBlur={e => { onRenameColumn(c.key, e.currentTarget.value); setRenaming(null); }} />
          ) : (
            <>
              <label className="check" style={{ flex: 1, minWidth: 0 }}>
                <input type="checkbox" checked={!c.hidden} onChange={() => onToggleColumn(c.key)} />
                <span className="truncate">{c.header}</span>
              </label>
              {!readOnly && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {(renameAny || c.role === 'extra') && (
                    <button className="iconbtn" title="Rename this column"
                            onClick={() => setRenaming(c.key)}>✎</button>
                  )}
                  {c.role === 'extra' && (
                    <button className="iconbtn iconbtn--danger" title="Remove this column"
                            onClick={() => onRemoveColumn(c.key)}>✕</button>
                  )}
                </span>
              )}
            </>
          )}
        </div>
      ))}
      <hr className="menu__sep" />
      {!readOnly && (
        <div className="menu__item" style={{ cursor: 'default', gap: 6 }}>
          <input value={adding} onChange={e => setAdding(e.target.value)} placeholder="New column…"
                 className="input--sm" style={{ height: 26 }}
                 onKeyDown={e => { if (e.key === 'Enter' && adding.trim()) { onAddColumn(adding); setAdding(''); } }} />
          <button className="btn btn--sm" disabled={!adding.trim()}
                  onClick={() => { onAddColumn(adding); setAdding(''); }}>Add</button>
        </div>
      )}
      <button type="button" className="menu__item" onClick={() => { onShowAllColumns(); close(); }}>
        <span>Show every column</span>
      </button>
      <div className="menu__head" style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)' }}>
        Drag a heading to move a column; drag its edge to resize.
      </div>
    </>
  );
}

function FilterMenu({ columns, filters, setFilters, rows }) {
  const visible = columns.filter(c => !c.hidden);
  const add = () => setFilters(f => [...f, { key: visible[0] ? visible[0].key : '', op: 'contains', value: '' }]);
  const patch = (i, p) => setFilters(f => f.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const drop = i => setFilters(f => f.filter((_, k) => k !== i));
  return (
    <Dropdown label={filters.length ? `Filter · ${filters.length}` : 'Filter'} width={420}
              className={'btn btn--sm' + (filters.length ? ' is-on' : '')} onOpen={() => { if (!filters.length) add(); }}>
      {() => (
        <>
          <div className="menu__head">Show rows where</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px 8px' }}>
            {filters.map((f, i) => {
              const col = columns.find(c => c.key === f.key);
              const ops = FILTER_OPS.filter(o => !col || o.types.includes(col.type));
              const needsValue = f.op !== 'empty' && f.op !== 'filled';
              return (
                <div key={i} className="filterrow">
                  <select className="input--sm" value={f.key} onChange={e => patch(i, { key: e.target.value })}>
                    {visible.map(c => <option key={c.key} value={c.key}>{c.header}</option>)}
                  </select>
                  <select className="input--sm" value={f.op} onChange={e => patch(i, { op: e.target.value })}>
                    {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                  </select>
                  {needsValue
                    ? <input className="input--sm" value={f.value ?? ''} placeholder="value"
                             onChange={e => patch(i, { value: e.target.value })} />
                    : <span className="hint">—</span>}
                  <button className="iconbtn iconbtn--danger" title="Remove this filter"
                          onClick={() => drop(i)}>✕</button>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '0 8px 8px' }}>
            <button className="btn btn--sm" onClick={add}>+ Another</button>
            <button className="btn btn--sm" disabled={!filters.length} onClick={() => setFilters([])}>Clear all</button>
            <span className="spacer" />
            <span className="hint" style={{ alignSelf: 'center' }}>
              {rows.shown.toLocaleString()} of {rows.total.toLocaleString()}
            </span>
          </div>
        </>
      )}
    </Dropdown>
  );
}
