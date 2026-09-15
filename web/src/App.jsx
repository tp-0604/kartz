/**
 * The shell.
 *
 * Two destinations, because there are two jobs: information comes in, and information is worked
 * on. Everything the old app had a tab for — the sheet, the history, the roster — is a dataset
 * or a view inside Data, because that is what they always were.
 *
 * Both halves stay mounted once opened. Switching away from a workspace with a queue of unsaved
 * operations in it must not throw them away, and switching away from a finished extraction must
 * not lose the rows.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AppProvider, MODES, useApp } from './state/AppContext.jsx';
import ExtractScreen from './extract/ExtractScreen.jsx';
import SetupDialog from './app/SetupDialog.jsx';
import CommandPalette from './app/CommandPalette.jsx';
import { VIEWS } from './workspace/DatasetNav.jsx';
import { BUILD } from './extractor/config.js';

// The workspace is the larger half of the bundle and the extractor is what a phone opens.
const DataWorkspace = lazy(() => import('./workspace/DataWorkspace.jsx'));

const MODKEY = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl K';

function Shell() {
  const { mode, go, notice, setupOpen, setSetupOpen, paletteOpen, setPaletteOpen,
          boards, datasets, openInData } = useApp();
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

  const commands = useMemo(() => {
    const out = [
      { id: 'go-extract', group: 'Go', kind: 'screen', label: 'Extract a recording', run: () => go('extract') },
      { id: 'go-data', group: 'Go', kind: 'screen', label: 'Data workspace', run: () => go('data') },
      { id: 'open-roster', group: 'Go', kind: 'dataset', label: 'Roster',
        where: datasets ? `${datasets.roster.rows} players` : '',
        run: () => openInData({ kind: 'dataset', key: 'roster' }) },
      ...VIEWS.map(v => ({ id: 'view-' + v.id, group: 'Go', kind: 'view', label: v.label,
                           run: () => openInData({ kind: 'view', id: v.id }) })),
      { id: 'setup', group: 'Do', kind: 'action', label: 'Setup — the shared phrase and this device',
        run: () => setSetupOpen(true) },
    ];
    for (const b of boards)
      out.push({ id: b.key, group: 'Boards', kind: 'board',
                 label: `${b.alliance} · ${b.date}${b.label ? ' · ' + b.label : ''}`,
                 where: `${b.rows} rows`,
                 run: () => openInData({ kind: 'dataset', key: b.key }) });
    return out;
  }, [boards, datasets, go, openInData, setSetupOpen]);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => go('extract')} title="Kartz"><i />Kartz</button>
        <nav className="nav" aria-label="Sections">
          {MODES.map(m => (
            <button key={m.id} type="button" className="nav__item" title={m.hint}
                    aria-current={mode === m.id ? 'page' : undefined}
                    onClick={() => go(m.id)}>{m.label}</button>
          ))}
        </nav>
        <div className="topbar__meta">
          <button className="kbar" onClick={() => setPaletteOpen(true)}>
            <span>Search everything</span><kbd>{MODKEY}</kbd>
          </button>
          <span className="build">{BUILD}</span>
          <button className="btn btn--sm" onClick={() => setSetupOpen(true)}>Setup</button>
        </div>
      </header>

      <main style={{ minHeight: 0, position: 'relative' }}>
        <div className="screen" hidden={mode !== 'extract'}><ExtractScreen /></div>
        <div style={{ height: '100%', minHeight: 0 }} hidden={mode !== 'data'}>
          {dataMounted && (
            <Suspense fallback={<div className="loading">Opening the workspace…</div>}>
              <DataWorkspace active={mode === 'data'} />
            </Suspense>
          )}
        </div>
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
