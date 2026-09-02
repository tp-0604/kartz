import { Suspense, lazy, useEffect, useState } from 'react';
import { AppProvider, TABS, useApp } from './state/AppContext.jsx';
import ExtractScreen from './components/extract/ExtractScreen.jsx';
import HistoryScreen from './components/history/HistoryScreen.jsx';
import RosterScreen from './components/roster/RosterScreen.jsx';
import SetupPanel from './components/SetupPanel.jsx';
import { BUILD } from './extractor/config.js';

// The workbook is by far the largest thing in the bundle, and it is only needed on one screen.
const SheetScreen = lazy(() => import('./components/sheet/SheetScreen.jsx'));

function Shell() {
  const { tab, go, notice, setupOpen, setSetupOpen } = useApp();
  // Once the sheet has been opened it stays mounted — switching screens must not throw away an
  // unsaved workbook — and is simply hidden while another screen is up.
  const [sheetMounted, setSheetMounted] = useState(tab === 'sheet');
  useEffect(() => { if (tab === 'sheet') setSheetMounted(true); }, [tab]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="container topbar__in">
          <button className="brand" onClick={() => go('extract')}><i />Kartz</button>
          <nav className="nav" aria-label="Screens">
            {TABS.map(t => (
              <button key={t.id} type="button" className="nav__item" title={t.hint}
                      aria-current={tab === t.id ? 'page' : undefined}
                      onClick={() => go(t.id)}>{t.label}</button>
            ))}
          </nav>
          <div className="topbar__spacer" />
          <span className="build">{BUILD}</span>
          <button className="btn btn--sm" onClick={() => setSetupOpen(true)}>Setup</button>
        </div>
      </header>

      <main className="page container">
        <div className="pane" hidden={tab !== 'extract'}><ExtractScreen /></div>
        <div className="pane" hidden={tab !== 'sheet'}>
          {sheetMounted && (
            <Suspense fallback={<div className="loading">Loading the workbook…</div>}>
              <SheetScreen />
            </Suspense>
          )}
        </div>
        <div className="pane" hidden={tab !== 'history'}><HistoryScreen active={tab === 'history'} /></div>
        <div className="pane" hidden={tab !== 'roster'}><RosterScreen /></div>
      </main>

      {notice && <div className={'toast' + (notice.kind === 'ok' ? '' : ' toast--' + notice.kind)} role="status">{notice.text}</div>}
      {setupOpen && <SetupPanel onClose={() => setSetupOpen(false)} />}
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
