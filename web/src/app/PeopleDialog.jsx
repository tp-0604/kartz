/**
 * Everybody with an account, and what they may do.
 *
 * Any admin can see this list — it is how you find out whose board is whose. Only the owner can
 * change it: make somebody an admin, take it back, remove an account, or hand Kartz over. The
 * Worker enforces every one of those (worker/auth.js); the buttons here only stop you asking.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import * as API from '../services/api.js';
import { Empty } from '../components/shared/ui.jsx';
import { isOwner } from '../utils/roles.js';

const ROLE = { owner: 'owner', admin: 'admin', member: 'member' };
const CAN = {
  owner: 'Everything, including who else may do what.',
  admin: 'Everything with the data: the spreadsheet, the roster, and any board.',
  member: 'Edits rows in the grid, sends recordings, and manages the boards they sent.',
};

export default function PeopleDialog({ onClose }) {
  const { user, notify } = useApp();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const mine = isOwner(user);

  const load = useCallback(() => API.listUsers()
    .then(j => setRows(j.users || []))
    .catch(e => { setRows([]); notify('Could not read the accounts: ' + e.message, 'bad'); }), [notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (id, what, job) => {
    setBusy(id);
    try { const out = await job(); await load(); notify(what(out), 'ok'); }
    catch (e) { notify(e.message, 'bad'); }
    finally { setBusy(''); }
  };

  const setRole = (u, role) => run(u.id, () => role === 'admin' ? `${u.name} is an admin now.`
                                                                : `${u.name} is a member again.`,
                                   () => API.setUserRole(u.id, role));

  const handOver = u => {
    if (!window.confirm(`Hand Kartz over to ${u.name}?\n\n`
      + 'They become the owner and decide who else may do what. You stay on as an admin. '
      + 'Only they can hand it back.')) return;
    // Your own role changed with theirs, so the app is reopened as what you are now.
    run(u.id, () => `${u.name} owns Kartz now. You are an admin.`, () => API.setUserRole(u.id, 'owner'))
      .then(() => setTimeout(() => location.reload(), 900));
  };

  const remove = u => {
    if (!window.confirm(`Remove the account ${u.name}?\n\n`
      + (u.boards ? `The ${u.boards} board${u.boards === 1 ? '' : 's'} they sent stay in the database, `
                    + 'with nobody\'s name on them, until an admin gives them to somebody.\n\n' : '')
      + 'They are signed out everywhere and would have to sign up again.')) return;
    run(u.id, out => `${out.removed} is gone.`, () => API.removeUser(u.id));
  };

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog dialog--wide" role="dialog" aria-modal="true" aria-label="People">
        <div className="dialog__head">
          <h2>People</h2>
          <span className="pill pill--flat">{rows ? rows.length : '…'}</span>
          <button className="btn btn--sm btn--quiet" onClick={onClose}>Close</button>
        </div>

        <div className="dialog__body">
          <p className="hint">
            {mine ? 'You own Kartz, so this is yours to decide. An admin can edit anything and use the '
                    + 'spreadsheet; a member edits rows in the grid and manages the boards they sent.'
                  : 'Who has an account, and what they may do. Only whoever owns Kartz can change this.'}
          </p>

          {!rows ? <div className="loading">Loading…</div>
            : !rows.length ? <Empty title="Nobody yet">Accounts appear here as people sign up.</Empty> : (
            <div className="tablewrap"><table className="tbl people">
              <thead>
                <tr><th>Name</th><th>Can</th><th className="num">Boards</th><th /></tr>
              </thead>
              <tbody>
                {rows.map(u => {
                  const self = u.id === user.id;
                  const owner = u.role === 'owner';
                  return (
                    <tr key={u.id} className={busy === u.id ? 'is-busy' : undefined}>
                      <td>
                        <b>{u.name}</b>{self && <span className="hint"> — you</span>}
                        <div className="hint">{ROLE[u.role] || u.role}</div>
                      </td>
                      <td className="hint">{CAN[u.role] || ''}</td>
                      <td className="num">{u.boards || 0}</td>
                      <td className="people__do">
                        {mine && !self && !owner && (
                          <>
                            {u.role === 'member'
                              ? <button className="btn btn--sm" disabled={!!busy}
                                        onClick={() => setRole(u, 'admin')}>Make admin</button>
                              : <button className="btn btn--sm" disabled={!!busy}
                                        onClick={() => setRole(u, 'member')}>Make member</button>}
                            <button className="btn btn--sm btn--quiet" disabled={!!busy}
                                    onClick={() => handOver(u)}>Hand over…</button>
                            <button className="btn btn--sm btn--danger" disabled={!!busy}
                                    onClick={() => remove(u)}>Remove</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </div>
  );
}
