/**
 * Who you are, before anything else.
 *
 * Everyone has an account: an in-game name, written plainly, and a password. The name goes on the
 * boards you send and the edits you make, so it is the one people know you by, and it belongs to
 * one account only. An admin signs up the same way and brings the admin code. The Worker checks
 * all of it; the checks here only save a round trip.
 */
import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import * as API from '../services/api.js';

const NAME_RE = /^[A-Za-z0-9 _.'-]{2,24}$/;
const sentence = m => (m ? m.charAt(0).toUpperCase() + m.slice(1) : m);

export default function AuthScreen() {
  const { acceptSession } = useApp();
  const [mode, setMode] = useState('signup');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [admin, setAdmin] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = name.replace(/\s+/g, ' ').trim();
  const signup = mode === 'signup';

  const edit = set => e => { set(e.target.value); setError(''); };
  const switchTo = m => { setMode(m); setError(''); setPassword(''); setConfirm(''); };

  const submit = async e => {
    e.preventDefault();
    setError('');
    if (!clean) return setError('Enter your in-game name.');
    if (signup) {
      if (!NAME_RE.test(clean))
        return setError("Use plain letters, numbers, spaces and - _ . ' only — no fancy text — between 2 and 24 characters.");
      if (password.length < 6) return setError('Choose a password of at least 6 characters.');
      if (password !== confirm) return setError('The two passwords are different.');
      if (admin && !code.trim()) return setError('Enter the admin code, or untick “I’m an admin”.');
    } else if (!password) return setError('Enter your password.');
    setBusy(true);
    try {
      const out = signup
        ? await API.signUp({ name: clean, password, admin, adminCode: admin ? code.trim() : undefined })
        : await API.signIn({ name: clean, password });
      acceptSession(out);
    } catch (err) {
      setError(sentence(err.message || String(err)));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit} noValidate>
        <div className="auth__mark" aria-hidden="true" />
        <div>
          <h1>{signup ? 'Welcome to Kartz' : 'Welcome back'}</h1>
          <p className="auth__lede">{signup
            ? 'Make an account with the name people know you by in the game. It goes on the boards you send and the edits you make.'
            : 'Sign in with your in-game name and password.'}</p>
        </div>

        <div className="nav auth__tabs">
          <button type="button" className="nav__item" aria-current={signup ? 'page' : undefined}
                  onClick={() => switchTo('signup')}>Create account</button>
          <button type="button" className="nav__item" aria-current={!signup ? 'page' : undefined}
                  onClick={() => switchTo('signin')}>Sign in</button>
        </div>

        <div className="field">
          <label className="label" htmlFor="authname">In-game name (no fancy text)</label>
          <input id="authname" value={name} onChange={edit(setName)} maxLength={24} placeholder="Amy"
                 autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
          {signup && <span className="hint">Plain letters and numbers, as close to your in-game name as you can type it.</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="authpass">Password</label>
          <input id="authpass" type="password" value={password} onChange={edit(setPassword)}
                 autoComplete={signup ? 'new-password' : 'current-password'} />
        </div>
        {signup && (
          <div className="field">
            <label className="label" htmlFor="authconfirm">Password again</label>
            <input id="authconfirm" type="password" value={confirm} onChange={edit(setConfirm)} autoComplete="new-password" />
          </div>
        )}
        {signup && (
          <label className="check">
            <input type="checkbox" checked={admin} onChange={e => { setAdmin(e.target.checked); setError(''); }} />
            <span>I’m an admin</span>
          </label>
        )}
        {signup && admin && (
          <div className="field">
            <label className="label" htmlFor="authcode">Admin code</label>
            <input id="authcode" type="password" value={code} onChange={edit(setCode)} autoComplete="off" />
            <span className="hint">Whoever runs Kartz has it. It is checked by the server.</span>
          </div>
        )}

        {error && <div className="note note--bad" role="alert">{error}</div>}

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
          {busy ? 'One moment…' : signup ? (admin ? 'Create admin account' : 'Create account') : 'Sign in'}
        </button>
        <p className="hint auth__foot">
          {signup ? 'Already have an account? ' : 'New here? '}
          <button type="button" className="linkbtn" onClick={() => switchTo(signup ? 'signin' : 'signup')}>
            {signup ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </div>
  );
}
