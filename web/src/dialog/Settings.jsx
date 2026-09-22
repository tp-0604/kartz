/**
 * The three things this add-on has to be told, and nothing else.
 *
 * Which tab the roster is on, where the Worker lives, and the phrase that proves this
 * spreadsheet may use it. All three are kept in the spreadsheet's own properties — not in this
 * browser — so anybody who opens the sheet gets the same setup and nobody has to type it twice.
 *
 * Beside them, what Kartz thinks each heading on the current tab means. It is the thing people
 * actually want to check, and the dialog is wide enough to show it without scrolling.
 */
import { useEffect, useState } from 'react';
import * as Sheet from './bridge.js';
import * as API from '../services/api.js';
import { guessFields, FIELDS } from './fields.js';

export default function Settings({ sheet, roster, worker, top, onClose }) {
  const [url, setUrl] = useState((worker && worker.url) || '');
  const [pass, setPass] = useState('');
  const [tab, setTab] = useState('');
  const [state, setState] = useState(null);
  const [mapping, setMapping] = useState([]);

  useEffect(() => {
    Sheet.readSettings().then(s => setTab(s.rosterTab || '')).catch(() => {});
    if (sheet) setMapping(guessFields(sheet.headers));
  }, [sheet]);

  const save = async () => {
    setState('saving…');
    try {
      await Sheet.setWorker(url.trim(), pass);
      await Sheet.writeSettings({ rosterTab: tab.trim() || null });
      API.useWorker({ url: url.trim(), pass });
      const status = await API.aiStatus().catch(e => ({ available: false, reason: e.message }));
      setState(status.available ? 'The Worker answered — ' + (status.model || 'model ready')
                                : 'Saved, but the Worker said: ' + (status.reason || 'no model'));
    } catch (e) {
      setState(e.message || String(e));
    }
  };

  return (
    <div className="dlg">
      {top}
      <div className="dlg__body">
        <aside className="dlg__rail">
          <p className="dlg__h">Settings</p>
          <div className="field">
            <label htmlFor="st-tab">Roster tab</label>
            <select id="st-tab" value={tab} onChange={e => setTab(e.target.value)}>
              <option value="">find it automatically</option>
              {(sheet ? sheet.tabs : []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <small className="hint">
              {roster && roster.ok
                ? `${roster.count} players on “${roster.tab}”`
                : (roster && roster.reason) || 'not found yet'}
            </small>
          </div>

          <div className="field">
            <label htmlFor="st-url">Worker address</label>
            <input id="st-url" value={url} onChange={e => setUrl(e.target.value)}
                   placeholder="https://kartz.<you>.workers.dev" spellCheck={false} />
          </div>
          <div className="field">
            <label htmlFor="st-pass">Shared phrase</label>
            <input id="st-pass" type="password" value={pass} onChange={e => setPass(e.target.value)}
                   placeholder={worker && worker.hasPass ? '•••••••• (set)' : 'not set'} />
            <small className="hint">
              The phrase the Worker was given with <code>wrangler secret put SHARED_PASS</code>. It
              is kept in this spreadsheet, never in the browser, and only people who can edit the
              sheet can reach it.
            </small>
          </div>

          <button type="button" className="btn btn--go btn--wide" onClick={save}>Save and test</button>
          {state && <p className="note">{state}</p>}
        </aside>

        <section className="dlg__stage">
          <p className="dlg__h">Columns on “{sheet ? sheet.sheet : 'this tab'}”</p>
          <p className="hint">
            What each heading looks like to Kartz. A column left alone is never written to, so a
            formula or a total in the middle of the sheet keeps working.
          </p>
          <ul className="cols">
            {mapping.map((m, i) => (
              <li key={i}>
                <b>{m.header || <em>column {i + 1}</em>}</b>
                <span>{m.field ? (FIELDS.find(f => f.id === m.field) || {}).label : 'left alone'}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="dlg__foot">
        <span className="grow">Kept in this spreadsheet — everyone who opens it gets the same setup.</span>
        <button type="button" className="btn btn--go" onClick={onClose}>Done</button>
      </footer>
    </div>
  );
}
