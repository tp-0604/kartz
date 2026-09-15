// Everything that is set once per device: whether this browser may talk to the Worker, and what
// this browser is holding on to. A dialog rather than a screen, because it is visited once.
import { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { aiStatus, apiBase, getPass, isCrossOrigin, ping, setPass } from '../services/api.js';
import { BUILD } from '../extractor/config.js';
import { store } from '../utils/storage.js';
import { FlashButton } from '../components/shared/ui.jsx';

export default function SetupDialog({ onClose }) {
  const { roster, rosterMeta, refreshDatasets, loadRoster, openInData } = useApp();
  const [pass, setPassState] = useState(getPass());
  const [conn, setConn] = useState({ state: 'checking', text: 'checking…' });
  const [ai, setAi] = useState(null);

  const check = async () => {
    setConn({ state: 'checking', text: 'checking…' });
    try { await ping(); setConn({ state: 'ok', text: 'connected — the Worker accepts this browser' }); }
    catch (e) { setConn({ state: 'bad', text: e.message }); }
    aiStatus().then(setAi).catch(() => setAi({ available: false, reason: 'the Worker did not answer.' }));
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
    await Promise.all([refreshDatasets(), loadRoster().catch(() => {})]);
    return 'Saved ✓';
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Setup">
        <div className="dialog__head">
          <h2>Setup</h2>
          <span className={'pill pill--' + (conn.state === 'ok' ? 'ok' : conn.state === 'bad' ? 'bad' : 'flat')}>
            {conn.state === 'ok' ? 'connected' : conn.state === 'bad' ? 'not connected' : 'checking'}
          </span>
          <button className="btn btn--sm btn--quiet" onClick={onClose}>Close</button>
        </div>

        <div className="dialog__body">
          <div className="stack stack--tight">
            <label className="label" htmlFor="pass">Shared phrase</label>
            <input id="pass" type="password" value={pass} onChange={e => setPassState(e.target.value)}
                   placeholder={isCrossOrigin() ? 'required — ask whoever runs the Worker'
                                                : 'not needed when the Worker serves this page'}
                   autoComplete="off" spellCheck={false} />
            <p className="hint">The Worker holds the model key. When this page is hosted somewhere
              else it proves itself with this phrase, set on the Worker with
              <code> wrangler secret put SHARED_PASS</code>. It stays in this browser and is sent
              only to the Worker.</p>
            <p className={'hint ' + (conn.state === 'bad' ? 'muted' : '')}>{conn.text}</p>
            <div className="btnrow">
              <FlashButton className="btn btn--primary" onClick={savePass}>Save phrase</FlashButton>
              <button className="btn" onClick={check}>Test connection</button>
            </div>
          </div>

          <div className="stack stack--tight">
            <span className="label">Roster</span>
            <p className="hint">
              {roster.length ? `${roster.length} players, ${rosterMeta.columns.length} columns`
                             : 'no players yet'}.
              The roster is kept in this app's own database and edited in the Data workspace.
              Nothing is pulled from a Google Sheet.
            </p>
            <div className="btnrow">
              <button className="btn" onClick={() => { onClose(); openInData({ kind: 'dataset', key: 'roster' }); }}>
                Open the roster
              </button>
            </div>
          </div>

          <div className="stack stack--tight">
            <span className="label">Analysis</span>
            <p className="hint">
              {!ai ? 'checking…'
                : ai.available
                  ? `Questions are answered by ${ai.provider} · ${ai.model}${ai.gateway ? ', through your AI Gateway' : ''}. `
                    + 'They are answered by querying this database through a fixed set of tools — the rows '
                    + 'themselves are never sent to a model.'
                  : ai.reason}
            </p>
          </div>

          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr',
                                      gap: '6px var(--s4)', fontSize: 12.5 }}>
            <dt className="label">API</dt>
            <dd className="mono" style={{ margin: 0, wordBreak: 'break-all', color: 'var(--ink2)' }}>
              {apiBase()}{isCrossOrigin() ? ' · another origin, phrase required' : ' · same origin'}
            </dd>
            <dt className="label">Build</dt>
            <dd className="mono" style={{ margin: 0, color: 'var(--ink2)' }}>{BUILD}</dd>
            <dt className="label">Cached</dt>
            <dd style={{ margin: 0, color: 'var(--ink2)' }}>
              the roster, remembered fixes, unsent edits and your last view live in this browser only
            </dd>
          </dl>
        </div>

        <div className="dialog__foot">
          <button className="btn btn--danger btn--sm" onClick={() => {
            if (!window.confirm('Forget the cached roster and remembered fixes on this device?\n\n'
              + 'Anything not yet saved to the database goes with them.')) return;
            store.del('roster'); store.del('aliases');
            location.reload();
          }}>Forget cached data on this device</button>
        </div>
      </div>
    </div>
  );
}
