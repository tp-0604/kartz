/**
 * Asking the dataset a question.
 *
 * It belongs to the Data workspace, not to a chat window: it sits in the workspace header where
 * a search box would, it knows what is on screen, and it is one line high whether or not it has
 * ever been used. When no provider is configured it says so and stops being in the way.
 */
import { useEffect, useRef, useState } from 'react';

const MOD = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '') ? '⌘J' : 'Ctrl J';

export default function AskBar({ analyst, context }) {
  const [q, setQ] = useState('');
  const input = useRef(null);

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        analyst.open();
        input.current && input.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [analyst]);

  const off = analyst.status && !analyst.status.available;
  const send = () => {
    const text = q.trim();
    if (!text) return;
    setQ('');
    analyst.ask(text, context);
  };

  return (
    <div className={'askbar' + (off ? ' is-off' : '')}
         title={off ? analyst.status.reason : 'Ask about the rows on screen'}>
      <span className="askbar__mark" aria-hidden="true">✦</span>
      <input ref={input} value={q} onChange={e => setQ(e.target.value)} disabled={off}
             placeholder={off ? 'Analysis is switched off on this Worker' : 'Ask your data anything…'}
             aria-label="Ask your data a question" spellCheck={false}
             onFocus={analyst.open}
             onKeyDown={e => {
               if (e.key === 'Enter') { e.preventDefault(); send(); }
               if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); }
             }} />
      {q ? <button className="btn btn--primary askbar__go" onClick={send}>Ask</button> : <kbd>{MOD}</kbd>}
    </div>
  );
}
