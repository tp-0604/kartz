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
  // Once the sheet has been opened it stays mounted — switching tabs must not throw away an
  // unsaved workbook — and is simply hidden while another screen is up.
  const [sheetMounted, setSheetMounted] = useState(tab === 'sheet');
  useEffect(() => { if (tab === 'sheet') setSheetMounted(true); }, [tab]);

  return (
    <>
      <header className="top"><div className="topin">
        <div className="brand" onClick={() => go('extract')} role="button" tabIndex={0}><u />Kartz</div>
        <nav className="mtabs" aria-label="Screens">
          {TABS.map(t => (
            <button key={t.id} type="button" className={'mtab' + (tab === t.id ? ' on' : '')}
                    onClick={() => go(t.id)} title={t.hint}>{t.label}</button>
          ))}
        </nav>
        <button type="button" className="gear" onClick={() => setSetupOpen(true)} title="Setup: connection and roster">
          <span aria-hidden="true">⚙</span><span className="gearlabel">Setup</span>
        </button>
        <span className="build" title="build">{BUILD}</span>
      </div></header>

      <div className="wrap">
        <div className="pane" hidden={tab !== 'extract'}><ExtractScreen active={tab === 'extract'} /></div>
        <div className="pane sheetpane" hidden={tab !== 'sheet'}>
          {sheetMounted && (
            <Suspense fallback={<section className="loading">Loading the workbook…</section>}>
              <SheetScreen active={tab === 'sheet'} />
            </Suspense>
          )}
        </div>
        <div className="pane" hidden={tab !== 'history'}><HistoryScreen active={tab === 'history'} /></div>
        <div className="pane" hidden={tab !== 'roster'}><RosterScreen active={tab === 'roster'} /></div>
      </div>

      {notice && <div className={'toast t-' + notice.kind} role="status">{notice.text}</div>}
      {setupOpen && <SetupPanel onClose={() => setSetupOpen(false)} />}
    </>
  );
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
