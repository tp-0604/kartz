/**
 * A question about the sheet in front of you.
 *
 * The rows travel with the question and nothing is kept: the Worker holds the model key, asks,
 * and answers. There is no database behind this — the spreadsheet is the data, which makes the
 * answer exactly as current as the sheet is.
 *
 * Because the dialog is modeless, the tab it reads is whichever one you are standing on. Move
 * to another tab, press Ask again, and the answer is about that one.
 */
import { useState } from 'react';
import * as API from '../services/api.js';
import * as Sheet from './bridge.js';

const EXAMPLES = [
  'Who is missing from this board?',
  'Average score by alliance',
  'Who dropped the most since last time?',
  'Which names here are not on the roster?',
];

export default function AskPanel({ sheet, top, onClose }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [read, setRead] = useState(null);

  const ask = async question => {
    const text = (question || q).trim();
    if (!text) return;
    setBusy(true); setError(null); setAnswer(null); setRead(null);
    try {
      // The rows go with the question. The tab is read here, now, rather than remembered.
      const here = await Sheet.readRows(300);
      const out = await API.ask({ question: text, sheet: here });
      setAnswer(out);
      setRead(here);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const metrics = ((answer && answer.components) || []).filter(c => c.type === 'metric');

  return (
    <div className="dlg">
      {top}
      <div className="dlg__body">
        <aside className="dlg__rail">
          <p className="dlg__h">Ask about “{sheet ? sheet.sheet : 'this tab'}”</p>
          <textarea className="ask" rows={4} value={q} placeholder="Ask about what is on this tab…"
                    onChange={e => setQ(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }} />
          <button type="button" className="btn btn--go btn--wide" onClick={() => ask()}
                  disabled={busy || !q.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
          <p className="dlg__h">Or one of these</p>
          <ul className="examples">
            {EXAMPLES.map(x => (
              <li key={x}><button type="button" onClick={() => { setQ(x); ask(x); }}>{x}</button></li>
            ))}
          </ul>
        </aside>

        <section className="dlg__stage">
          {error && <p className="note note--bad">{error}</p>}
          {busy && <div className="wait">reading the tab and asking…</div>}
          {!busy && !answer && !error && (
            <div className="wait">
              The rows on this tab go with the question. Nothing is stored.
            </div>
          )}
          {answer && (
            <div className="answer">
              <p>{answer.summary}</p>
              {metrics.length > 0 && (
                <div className="metrics">
                  {metrics.map((c, i) => (
                    <div key={i} className="metric"><b>{c.value}</b><span>{c.label}</span></div>
                  ))}
                </div>
              )}
              {(answer.components || []).filter(c => c.type === 'list').map((c, i) => (
                <ul key={i} className="examples">
                  {(c.items || []).map((it, j) => (
                    <li key={j}><button type="button" disabled>{typeof it === 'string' ? it : it.label}</button></li>
                  ))}
                </ul>
              ))}
              <p className="hint">
                {answer.model ? `${answer.model} · ` : ''}
                read {answer.rowsRead || (read && read.rows.length) || 0} rows
                {answer.rowsNotRead ? ` of ${(answer.rowsRead || 0) + answer.rowsNotRead}` : ''}
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="dlg__foot">
        <span className="grow">Answers come from the rows on this tab as they are right now.</span>
        <button type="button" className="btn" onClick={onClose}>Back</button>
      </footer>
    </div>
  );
}
