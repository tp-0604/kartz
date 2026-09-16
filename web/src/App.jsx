/**
 * The shell: one canvas, and sheets over it.
 *
 * Home is the month of boards. A board, the roster or a view opens in the workspace sheet; a
 * recording opens the extractor sheet. Putting either away comes back to the canvas.
 *
 * Both sheets stay mounted once opened. Putting one away with a queue of unsaved operations in it
 * must not throw them away, and putting away a finished extraction must not lose the rows.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext.jsx';
import ExtractScreen from './extract/ExtractScreen.jsx';
import HomeCanvas from './home/HomeCanvas.jsx';
import SetupDialog from './app/SetupDialog.jsx';
import CommandPalette from './app/CommandPalette.jsx';
import Dropdown from './components/shared/Dropdown.jsx';
import { VIEWS } from './app/views.js';
import { isDark, setTheme, themeChoice, useDark } from './utils/theme.js';

// The workspace is the larger half of the bundle and the extractor is what a phone opens.
const DataWorkspace = lazy(() => import('./workspace/DataWorkspace.jsx'));

const MODKEY = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl K';

function Shell() {
  const { mode, go, notice, setupOpen, setSetupOpen, paletteOpen, setPaletteOpen,
          boards, datasets, openInData, setImportRequest } = useApp();
  const dark = useDark();
  const [dataMounted, setDataMounted] = useState(mode === 'data');
  useEffect(() => { if (mode === 'data') setDataMounted(true); }, [mode]);

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  // The things anywhere can ask for, in one place, so the menu and ⌘K offer the same list.
  const actions = useMemo(() => ({
    extract: () => go('extract'),
    roster: () => openInData({ kind: 'dataset', key: 'roster' }),
    view: id => openInData({ kind: 'view', id }),
    newBoard: () => { setImportRequest('board'); openInData(null); },
    importFile: () => { setImportRequest('file'); openInData(null); },
    toggleTheme: () => setTheme(isDark() ? 'light' : 'dark'),
    followDevice: () => setTheme(null),
    setup: () => setSetupOpen(true),
  }), [go, openInData, setImportRequest, setSetupOpen]);

  const commands = useMemo(() => {
    const out = [
      { id: 'go-home', group: 'Go', kind: 'screen', label: 'Boards', where: 'the month canvas', run: () => go('home') },
      { id: 'go-extract', group: 'Go', kind: 'screen', label: 'Extract a recording', run: actions.extract },
      { id: 'open-roster', group: 'Go', kind: 'dataset', label: 'Roster',
        where: datasets ? `${datasets.roster.rows} players` : '', run: actions.roster },
      ...VIEWS.map(v => ({ id: 'view-' + v.id, group: 'Go', kind: 'view', label: v.label,
                           run: () => actions.view(v.id) })),
      { id: 'new-board', group: 'Do', kind: 'action', label: 'New empty board…', run: actions.newBoard },
      { id: 'import', group: 'Do', kind: 'action', label: 'Import a spreadsheet…', run: actions.importFile },
      { id: 'theme', group: 'Do', kind: 'action', label: dark ? 'Switch to light' : 'Switch to dark',
        run: actions.toggleTheme },
      { id: 'setup', group: 'Do', kind: 'action', label: 'Setup — the shared phrase and this device',
        run: actions.setup },
    ];
    for (const b of boards)
      out.push({ id: b.key, group: 'Boards', kind: 'board',
                 label: `${b.alliance} · ${b.date}${b.label ? ' · ' + b.label : ''}`,
                 where: `${b.rows} rows`,
                 run: () => openInData({ kind: 'dataset', key: b.key }) });
    return out;
  }, [actions, boards, dark, datasets, go, openInData]);

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go('home')} title="Back to the boards">
          <i aria-hidden="true" />Kartz
        </button>
        <div className="topbar__meta">
          <button type="button" className="kbar" onClick={() => setPaletteOpen(true)} aria-label="Search everything">
            <span className="kbar__icon" aria-hidden="true">⌕</span>
            <span className="kbar__text">Search everything</span>
            <kbd>{MODKEY}</kbd>
          </button>
          <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={actions.toggleTheme}
                  title={dark ? 'Switch to light' : 'Switch to dark'} aria-label={dark ? 'Switch to light' : 'Switch to dark'}>
            {dark ? '☀' : '☾'}
          </button>
          <Dropdown label="Menu" className="btn btn--sm" width={260} align="right" title="Everything else">
            {close => {
              const item = (label, run, hint) => (
                <button type="button" className="menu__item" onClick={() => { close(); run(); }}>
                  <span>{label}</span>{hint ? <span className="menu__hint">{hint}</span> : null}
                </button>
              );
              return (
                <>
                  {item('Extract a recording', actions.extract)}
                  {item('Roster', actions.roster, datasets ? String(datasets.roster.rows) : '')}
                  <hr className="menu__sep" />
                  <div className="menu__head">Views</div>
                  {VIEWS.map(v => <div key={v.id}>{item(v.label, () => actions.view(v.id))}</div>)}
                  <hr className="menu__sep" />
                  {item('New empty board…', actions.newBoard)}
                  {item('Import a spreadsheet…', actions.importFile)}
                  <hr className="menu__sep" />
                  {item(dark ? 'Light appearance' : 'Dark appearance', actions.toggleTheme)}
                  {themeChoice() && item('Match this device', actions.followDevice)}
                  {item('Setup', actions.setup)}
                </>
              );
            }}
          </Dropdown>
        </div>
      </header>

      <main className="stage">
        <HomeCanvas inert={mode !== 'home'} />

        <section className="sheet" hidden={mode !== 'extract'} aria-label="Extract a recording">
          <div className="sheet__bar">
            <button type="button" className="btn btn--sm backbtn" onClick={() => go('home')}>
              <span aria-hidden="true">‹</span> Boards
            </button>
            <h1>Extract a recording</h1>
          </div>
          <div className="sheet__body screen"><ExtractScreen /></div>
        </section>

        <section className="sheet" hidden={mode !== 'data'} aria-label="Workspace">
          <div className="sheet__body">
            {dataMounted && (
              <Suspense fallback={<div className="loading">Opening the workspace…</div>}>
                <DataWorkspace active={mode === 'data'} onClose={() => go('home')} />
              </Suspense>
            )}
          </div>
        </section>
      </main>

      {notice && (
        <div className={'toast' + (notice.kind === 'ok' ? '' : ' toast--' + notice.kind)} role="status">
          {notice.text}
        </div>
      )}
      {setupOpen && <SetupDialog onClose={() => setSetupOpen(false)} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
