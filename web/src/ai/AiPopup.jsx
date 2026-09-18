/**
 * The AI, from anywhere: one question box in the bar at the top, and this is what it opens.
 *
 * It knows what you are looking at — the board, its filters, what you have selected — and answers
 * by querying the database with a fixed set of tools. The answer is drawn here with this app's own
 * components: figures, tables, charts. Under each, where the figures came from and what it cost.
 */
import { useEffect, useRef, useState } from 'react';
import { Answer } from './AnalysisPanel.jsx';
import { EXAMPLES } from './useAnalyst.js';
import Boundary from '../components/shared/Boundary.jsx';

const EMPTY = { history: [], busy: false, error: null, question: '' };

export default function AiPopup({ analyst, context, onClose, onSource }) {
  const [q, setQ] = useState('');
  const input = useRef(null);
  const thread = useRef(null);
  const state = analyst.state || EMPTY;
  const off = !!analyst.status && !analyst.status.available;

  useEffect(() => { if (input.current) input.current.focus(); }, []);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [state.history.length, state.busy]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = text => {
    const t = String(text || '').trim();
    if (!t || state.busy || off) return;
    setQ('');
    analyst.ask(t, context);
  };

  return (
    <div className="aiscrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="aipop" role="dialog" aria-modal="true" aria-label="Ask Kartz">
        <header className="aipop__head">
          <span className="aipop__mark" aria-hidden="true">✦</span>
          <b>Ask Kartz</b>
          <span className="aipop__ctx truncate">
            {context ? 'Looking at ' + context.describes : 'Looking at every board'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn--sm btn--icon btn--quiet" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="aipop__thread" ref={thread}>
          {off && <div className="note note--flat">{analyst.status.reason}</div>}
          {!off && !state.history.length && !state.busy && !state.error && (
            <div className="aipop__empty">
              <p className="hint">Ask about a player, a board, a month or an alliance. Every figure in
                the answer comes from querying your boards, and it says which.</p>
              <div className="aiexamples">
                {EXAMPLES.map(x => <button key={x} type="button" onClick={() => send(x)}>{x}</button>)}
              </div>
            </div>
          )}
          <Boundary resetKey={state.history.length}
                    fallback={err => <div className="note note--bad">That answer could not be drawn: {String((err && err.message) || err)}</div>}>
            {state.history.map((item, i) => (
              <Answer key={i} item={item} onSource={s => { onSource(s); onClose(); }} />
            ))}
          </Boundary>
          {state.busy && (
            <div className="stack stack--tight">
              <div className="answer__q">{state.question}</div>
              <div className="thinking"><i />Looking through your boards…</div>
            </div>
          )}
          {state.error && (
            <div className="stack stack--tight">
              <div className="answer__q">{state.question}</div>
              <div className="note note--bad">{state.error}</div>
            </div>
          )}
        </div>

        <form className="aipop__ask" onSubmit={e => { e.preventDefault(); send(q); }}>
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} disabled={off} spellCheck={false}
                 aria-label="Your question"
                 placeholder={off ? 'Analysis is switched off on this Worker' : 'Ask anything about your boards…'} />
          <button className="btn btn--primary" type="submit" disabled={off || !q.trim() || state.busy}>Ask</button>
        </form>
      </section>
    </div>
  );
}
