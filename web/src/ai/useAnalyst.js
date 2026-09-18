/**
 * The analyst, as the workspace holds it: a status, a thread of answers, and one way to ask.
 *
 * It is deliberately a small piece of state living beside the dataset rather than inside it.
 * Nothing the grid does depends on any of this, and when the Worker has no provider configured
 * the whole thing reduces to a disabled input and a sentence saying why.
 */
import { useCallback, useEffect, useState } from 'react';
import { aiAsk, aiStatus } from '../services/api.js';

export const EXAMPLES = [
  'What is the average score here?',
  'Show the top 20 players by points.',
  'Which alliance has the highest average score?',
  'How has the average changed over the last 10 boards?',
  'Which players gained the most since the previous board?',
  'What stands out in this dataset?',
];

export function useAnalyst() {
  const [status, setStatus] = useState(null);
  const [state, setState] = useState(null);     // null until the panel is opened

  useEffect(() => {
    let live = true;
    aiStatus().then(s => live && setStatus(s))
      .catch(() => live && setStatus({ available: false, reason: 'the Worker did not answer.' }));
    return () => { live = false; };
  }, []);

  const open = useCallback(() => setState(s => s || { question: '', busy: false, error: null, history: [] }), []);
  const close = useCallback(() => setState(null), []);

  const ask = useCallback(async (question, context) => {
    const text = String(question || '').trim();
    if (!text) return;
    let history = [];
    setState(s => { history = s ? s.history : []; return { question: text, busy: true, error: null, history }; });
    try {
      const out = await aiAsk({
        question: text, context,
        // Two turns of context, so "and the one before that" means something without the whole
        // conversation being replayed at the model every time.
        history: history.slice(-2).flatMap(h => [
          { role: 'user', content: h.question },
          { role: 'assistant', content: h.answer.summary },
        ]),
      });
      // The Worker calls it an analysis; the panel calls it an answer. Naming it here keeps the
      // panel from having to know what the endpoint happens to call its payload.
      setState({ question: text, busy: false, error: null,
                 history: [...history, { question: text, answer: out.analysis, trace: out.trace,
                                         model: out.model, provider: out.provider, usage: out.usage }] });
    } catch (e) {
      setState({ question: text, busy: false, history, error: e.message || String(e) });
    }
  }, []);

  return { status, state, ask, open, close, available: !status || status.available };
}
