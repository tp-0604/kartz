// Everything that is set once per device: whether this browser may talk to the Worker, and
// where the roster comes from. It is a panel rather than a screen because it is visited once.
import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { apiBase, getPass, isCrossOrigin, ping, setPass } from '../services/api.js';
import { ROSTER_SHEET, BUILD } from '../extractor/config.js';
import { store } from '../utils/storage.js';
import { FlashButton } from './shared/ui.jsx';

export default function SetupPanel({ onClose }) {
  const { roster, rosterCache, pullRoster, notify, refreshBoards, loadEdits } = useApp();
  const [pass, setPassState] = useState(getPass());
  const [conn, setConn] = useState({ state: 'checking', text: 'checking…' });

  const check = async () => {
    setConn({ state: 'checking', text: 'checking…' });
    try { await ping(); setConn({ state: 'ok', text: 'connected — the Worker accepts this browser' }); }
    catch (e) { setConn({ state: 'bad', text: e.message }); }
  };
  useEffect(() => { check(); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const savePass = async () => {
    setPass(pass.trim());
    await check();
    await Promise.all([refreshBoards().catch(() => {}), loadEdits()]);
    return 'Saved ✓';
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" role="dialog" aria-modal="true" aria-label="Setup">
        <div className="shead">
          <h1>Setup</h1>
          <span className={'pill ' + (conn.state === 'ok' ? 'p-ok' : conn.state === 'bad' ? 'p-bad' : 'p-new')}>
            {conn.state === 'ok' ? 'connected' : conn.state === 'bad' ? 'not connected' : 'checking'}
          </span>
          <button className="ghost sm" onClick={onClose}>Close</button>
        </div>
        <p className="note" style={{ marginTop: 0 }}>{conn.text}</p>

        <div className="field">
          <label htmlFor="pass">Shared phrase</label>
          <input id="pass" type="password" value={pass} onChange={e => setPassState(e.target.value)}
                 placeholder={isCrossOrigin() ? 'required — ask whoever runs the Worker' : 'not needed when the Worker serves this page'}
                 autoComplete="off" spellCheck={false} />
          <p className="note">The Worker holds the Google key. When this page is hosted somewhere else — GitHub Pages — it
            proves itself with this phrase, which is set on the Worker with <code>wrangler secret put SHARED_PASS</code>.
            It stays in this browser and is sent only to the Worker.</p>
          <div className="btnrow" style={{ marginTop: 10 }}>
            <FlashButton onClick={savePass}>Save phrase</FlashButton>
            <button className="ghost" onClick={check}>Test connection</button>
          </div>
        </div>

        <div className="field">
          <label>Roster</label>
          <p className="note" style={{ marginTop: 0 }}>
            {roster.length ? `${roster.length} players cached on this device` : 'not pulled yet'}
            {rosterCache && rosterCache.cols ? ` · ${rosterCache.cols.length} columns` : ''}.
            The roster is read from the alliance's Google Sheet, which stays the place people maintain it.
          </p>
          <div className="btnrow" style={{ marginTop: 10 }}>
            <FlashButton onClick={async () => { const c = await pullRoster(); return `${c.all.length} rows ✓`; }}>
              Pull roster from the sheet
            </FlashButton>
            <a className="ghost" href={ROSTER_SHEET} target="_blank" rel="noreferrer"
               style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
                        border: '1px solid var(--line)', borderRadius: 'var(--btnrad)', padding: '12px 16px', fontWeight: 600, color: 'var(--accent)' }}>
              Open the sheet
            </a>
          </div>
        </div>

        <dl className="kv">
          <dt>API</dt><dd>{apiBase()}{isCrossOrigin() ? ' (another origin — phrase required)' : ' (same origin)'}</dd>
          <dt>Build</dt><dd>{BUILD}</dd>
          <dt>Cached</dt><dd>roster, aliases, drafts and your last tab live in this browser only</dd>
        </dl>
        <div className="btnrow">
          <button className="ghost" onClick={() => {
            if (!window.confirm('Forget the cached roster and remembered fixes on this device?')) return;
            store.del('roster'); store.del('aliases'); location.reload();
          }}>Forget cached data on this device</button>
        </div>
        {/* the Worker's phrase is never shown back: it is either set or it is not */}
        <p className="note">{notify ? '' : ''}</p>
      </div>
    </div>
  );
}
