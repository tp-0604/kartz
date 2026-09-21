/**
 * The shell: one canvas, sheets over it, and the AI in the bar above both.
 *
 * Home is the month of boards. A board, the roster or a view opens in the workspace sheet; a
 * recording opens the extractor sheet. Putting either away comes back to the canvas.
 *
 * Both sheets stay mounted once opened. Putting one away with a queue of unsaved operations in it
 * must not throw them away, and putting away a finished extraction must not lose the rows.
 *
 * Nothing is shown until somebody has signed in: every board, edit and question is somebody's.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AppProvider, useApp } from './state/AppContext.jsx';
import ExtractScreen from './extract/ExtractScreen.jsx';
import HomeCanvas from './home/HomeCanvas.jsx';
import SetupDialog from './app/SetupDialog.jsx';
import CommandPalette from './app/CommandPalette.jsx';
import AuthScreen from './app/AuthScreen.jsx';
import PeopleDialog from './app/PeopleDialog.jsx';
import Dropdown from './components/shared/Dropdown.jsx';
import AiPopup from './ai/AiPopup.jsx';
import Rail from './files/Rail.jsx';
import FilesScreen from './files/FilesScreen.jsx';
import { useAnalyst } from './ai/useAnalyst.js';
import { VIEWS } from './app/views.js';
import { isDark, setTheme, themeChoice, useDark } from './utils/theme.js';
import { isAdmin, isOwner, roleLabel } from './utils/roles.js';

// The workspace is the larger half of the bundle and the extractor is what a phone opens.
const DataWorkspace = lazy(() => import('./workspace/DataWorkspace.jsx'));

const MOD = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘' : 'Ctrl ';

function Shell() {
  const { mode, go, notice, setupOpen, setSetupOpen, paletteOpen, setPaletteOpen,
          boards, datasets, openInData, setImportRequest, user, signOut, aiContext,
          refreshTree, openSection } = useApp();
  const dark = useDark();
  const analyst = useAnalyst();
  const { open: openAnalyst } = analyst;
  const [aiOpen, setAiOpen] = useState(false);
  const [dataMounted, setDataMounted] = useState(mode === 'data');
  const [peopleOpen, setPeopleOpen] = useState(false);
  const admin = isAdmin(user);
  const owner = isOwner(user);
  useEffect(() => { if (mode === 'data') setDataMounted(true); }, [mode]);
  // The tree is what the rail is made of, so it is read once, as soon as anybody is signed in.
  useEffect(() => { refreshTree(); }, [refreshTree]);
  useEffect(() => { if (aiOpen) openAnalyst(); }, [aiOpen, openAnalyst]);

  useEffect(() => {
    const onKey = e => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setPaletteOpen(v => !v); }
      else if (k === 'j') { e.preventDefault(); setAiOpen(v => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  // "View source data" from an answer: the rows it was computed from, with its filters applied.
  const openSource = useCallback(source => {
    if (!source || !source.dataset) return;
    if (source.dataset.startsWith('board:') || source.dataset === 'roster') {
      const filters = (Array.isArray(source.filters) ? source.filters : [])
        .filter(f => f && f.field).map(f => ({ key: f.field, op: f.op || 'eq', value: f.value }));
      openInData({ kind: 'dataset', key: source.dataset, ...(filters.length ? { filters } : {}) });
    } else if (source.dataset.startsWith('month:')) {
      openInData({ kind: 'view', id: 'month' });
    }
  }, [openInData]);

  // The things anywhere can ask for, in one place, so the menu and ⌘K offer the same list.
  const actions = useMemo(() => ({
    extract: () => go('extract'),
    roster: () => openInData({ kind: 'dataset', key: 'roster' }),
    view: id => openInData({ kind: 'view', id }),
    newBoard: () => { setImportRequest('board'); openInData(null); },
    importFile: () => { setImportRequest('file'); openInData(null); },
    ask: () => setAiOpen(true),
    toggleTheme: () => setTheme(isDark() ? 'light' : 'dark'),
    followDevice: () => setTheme(null),
    setup: () => setSetupOpen(true),
    files: () => openSection(null),
    people: () => setPeopleOpen(true),
    signOut,
  }), [go, openInData, openSection, setImportRequest, setSetupOpen, signOut]);

  const commands = useMemo(() => {
    const out = [
      { id: 'ask', group: 'Do', kind: 'action', label: 'Ask Kartz a question', where: MOD + 'J', run: actions.ask },
      { id: 'go-home', group: 'Go', kind: 'screen', label: 'Boards', where: 'the month canvas', run: () => go('home') },
      { id: 'go-extract', group: 'Go', kind: 'screen', label: 'Extract a recording', run: actions.extract },
      { id: 'go-files', group: 'Go', kind: 'screen', label: 'Files', where: 'folders and workbooks',
        run: actions.files },
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
      { id: 'signout', group: 'Do', kind: 'action', label: `Sign out ${user.name}`, run: actions.signOut },
    ];
    if (admin)
      out.splice(out.length - 1, 0, { id: 'people', group: 'Do', kind: 'action', label: 'People and what they may do',
                                      where: owner ? 'yours to decide' : '', run: actions.people });
    for (const b of boards)
      out.push({ id: b.key, group: 'Boards', kind: 'board',
                 label: `${b.alliance} · ${b.date}${b.label ? ' · ' + b.label : ''}`,
                 where: `${b.rows} rows`,
                 run: () => openInData({ kind: 'dataset', key: b.key }) });
    return out;
  }, [actions, admin, boards, dark, datasets, go, openInData, owner, user.name]);

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go('home')} title="Back to the boards">
          <i aria-hidden="true" /><span className="brand__name">Kartz</span>
        </button>

        <button type="button" className="aibar" onClick={actions.ask} aria-label="Ask Kartz a question">
          <span className="aibar__mark" aria-hidden="true">✦</span>
          <span className="aibar__text">Ask anything about your boards…</span>
          <kbd>{MOD}J</kbd>
        </button>

        <div className="topbar__meta">
          <button type="button" className="kbar kbar--icon" onClick={() => setPaletteOpen(true)}
                  aria-label="Search everything" title={`Search everything (${MOD}K)`}>
            <span className="kbar__icon" aria-hidden="true">⌕</span>
            <kbd>{MOD}K</kbd>
          </button>
          <button type="button" className="btn btn--sm btn--icon btn--quiet topbar__theme" onClick={actions.toggleTheme}
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
                  {item('Files', actions.files, 'folders and workbooks')}
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
          <Dropdown className={'btn btn--sm me' + (admin ? ' is-admin' : '')} width={230} align="right"
                    title={`Signed in as ${user.name}`}
                    label={<><span className="me__av" aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
                             <span className="me__name">{user.name}</span></>}>
            {close => (
              <>
                <div className="menu__head">{user.name} · {roleLabel(user)}</div>
                {admin && (
                  <button type="button" className="menu__item" onClick={() => { close(); actions.people(); }}>
                    <span>People</span>
                    <span className="menu__hint">{owner ? 'who may do what' : 'who is here'}</span>
                  </button>
                )}
                <button type="button" className="menu__item" onClick={() => { close(); actions.signOut(); }}>
                  <span>Sign out</span>
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </header>

      <Rail narrow={mode === 'data' || mode === 'extract'} />

      <main className="stage">
        <HomeCanvas inert={mode !== 'home'} />

        <section className="sheet" hidden={mode !== 'files'} aria-label="Files">
          <div className="sheet__body">{mode === 'files' && <FilesScreen />}</div>
        </section>

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

      {aiOpen && (
        <AiPopup analyst={analyst} context={mode === 'data' ? aiContext : null}
                 onClose={() => setAiOpen(false)} onSource={openSource} />
      )}
      {notice && (
        <div className={'toast' + (notice.kind === 'ok' ? '' : ' toast--' + notice.kind)} role="status">
          {notice.text}
        </div>
      )}
      {setupOpen && <SetupDialog onClose={() => setSetupOpen(false)} />}
      {peopleOpen && <PeopleDialog onClose={() => setPeopleOpen(false)} />}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

function Root() {
  const { user, authChecked } = useApp();
  if (!authChecked) return <div className="auth"><div className="loading">Opening Kartz…</div></div>;
  if (!user) return <AuthScreen />;
  return <Shell />;
}

export default function App() {
  return <AppProvider><Root /></AppProvider>;
}
