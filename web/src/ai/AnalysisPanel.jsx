/**
 * What the analyst said, drawn by this application rather than by the model.
 *
 * The model returns an object in a fixed shape and nothing else — no HTML, no code, no markup of
 * any kind. Every component below is one this app already owns, and anything the model asks for
 * that is not on this list was dropped by the Worker before it got here. That is what makes the
 * panel look native: it is native.
 */
import { BarChart, LineChart, PlainTable, short } from './charts.jsx';
import { Delta } from '../components/shared/ui.jsx';
import { EXAMPLES } from './useAnalyst.js';

const FLAG = {
  measured: ['measured', 'every figure came from a query'],
  inferred: ['inferred', 'some of this is reasoning beyond the rows'],
  unavailable: ['no data', 'the rows needed are not in the database'],
};

export default function AnalysisPanel({ state, status, width, onDragStart, onClose, onSource, onAsk }) {
  return (
    <aside className="aipanel" style={{ width }} aria-label="Analysis">
      <div className="aipanel__grip" onMouseDown={onDragStart} title="Drag to resize" />
      <div className="aipanel__head">
        <h2>✦ Analysis</h2>
        <span className="spacer" />
        <button className="btn btn--sm btn--quiet" onClick={onClose} title="Close the panel">✕</button>
      </div>
      <div className="aipanel__body">
        {!state.history.length && !state.busy && !state.error && (
          <div className="stack stack--tight">
            <p className="hint">
              A question is answered by querying this database — the rows are never sent to a
              model. It sees what is on screen: the dataset, the filters, the sort and what you
              have selected.
            </p>
            <div className="aiexamples">
              {EXAMPLES.map(q => (
                <button key={q} type="button" onClick={() => onAsk(q)}>{q}</button>
              ))}
            </div>
            {status && status.available && (
              <p className="hint">Answering with {status.provider} · {status.model}.</p>
            )}
          </div>
        )}
        {state.history.map((item, i) => (
          <Answer key={i} item={item} onSource={onSource} />
        ))}
        {state.busy && (
          <div className="stack stack--tight">
            <div className="answer__q">{state.question}</div>
            <div className="thinking"><i />Querying the database…</div>
          </div>
        )}
        {state.error && (
          <div className="stack stack--tight">
            <div className="answer__q">{state.question}</div>
            <div className="note note--bad">{state.error}</div>
            <p className="hint">Nothing else in the app depends on this. The grid, the extractor
              and every save work whether or not a model answers.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function Answer({ item, onSource }) {
  const { question, answer, trace, model, provider } = item;
  const [flag, why] = FLAG[answer.confidence] || FLAG.measured;
  // Metrics read as a row of tiles rather than a stack, so consecutive ones are grouped.
  const blocks = [];
  for (const c of answer.components) {
    const last = blocks[blocks.length - 1];
    if (c.type === 'metric' && last && last.kind === 'metrics') last.items.push(c);
    else if (c.type === 'metric') blocks.push({ kind: 'metrics', items: [c] });
    else blocks.push({ kind: 'one', c });
  }

  return (
    <article className="answer">
      <div className="answer__q">{question}</div>
      <div>
        <h3 className="answer__title">{answer.title}</h3>
        <p className="answer__summary" style={{ marginTop: 4 }}>{answer.summary}</p>
      </div>

      {blocks.map((b, i) => b.kind === 'metrics'
        ? (
          <div className="kpis" key={i}>
            {b.items.map((m, k) => (
              <div className="kpi" key={k}>
                <span className="kpi__label">{m.label}</span>
                <span className="kpi__value" title={String(m.value)}>
                  {typeof m.value === 'number' ? short(m.value) : m.value}
                  {m.unit ? <small>{m.unit}</small> : null}
                </span>
                {typeof m.delta === 'number' && (
                  <span className="kpi__delta"><Delta d={m.delta} />{' '}
                    {m.deltaLabel && <span className="hint">{m.deltaLabel}</span>}</span>
                )}
                {m.note && <span className="kpi__note">{m.note}</span>}
              </div>
            ))}
          </div>
        )
        : <Component key={i} c={b.c} />)}

      {answer.sources.length > 0 && (
        <div className="sources">
          <span className="sources__head">Computed from</span>
          {answer.sources.map((s, i) => (
            <span className="source" key={i}>
              <b>{s.label || s.dataset}</b>
              {s.rows !== undefined && <span>· {s.rows.toLocaleString()} rows</span>}
              {s.dataset && onSource && (
                <button className="viz__toggle" onClick={() => onSource(s)}>View source data</button>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 'var(--s3)' }}>
        <span className={'answer__flag answer__flag--' + answer.confidence} title={why}>● {flag}</span>
        {model && <span className="hint">{provider} · {model}</span>}
        {trace && trace.length > 0 && (
          <details className="disclosure" style={{ flexBasis: '100%', padding: '8px 11px' }}>
            <summary>What it asked the database</summary>
            <div className="ailog">
              {trace.map((t, i) => (
                <span key={i} title={JSON.stringify(t.args)}>
                  {t.ok ? '·' : '✗'} {t.tool}({Object.keys(t.args || {}).join(', ')})
                  {t.rows !== undefined ? ` → ${t.rows} rows` : ''}
                  {t.error ? ` → ${t.error}` : ''}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

function Component({ c }) {
  switch (c.type) {
    case 'text':
      return <p className="answer__summary">{c.text}</p>;
    case 'table':
      return (
        <div className="viz">
          {c.title && <div className="viz__title">{c.title}</div>}
          <PlainTable columns={c.columns} rows={c.rows} />
          {c.note && <div className="viz__note">{c.note}</div>}
        </div>
      );
    case 'list':
      return (
        <div className="viz">
          {c.title && <div className="viz__title">{c.title}</div>}
          <PlainTable columns={['', '']} rows={c.items.map(i => [i.label, i.value])} />
          {c.note && <div className="viz__note">{c.note}</div>}
        </div>
      );
    case 'bar_chart':
      return <BarChart rows={c.rows} x={c.x} y={c.y} title={c.title} note={c.note} />;
    case 'line_chart':
      return <LineChart series={c.series} x={c.x} y={c.y} title={c.title} note={c.note} />;
    case 'comparison':
      return (
        <div className="viz">
          {c.title && <div className="viz__title">{c.title}</div>}
          <div className="tablewrap" style={{ maxHeight: 340 }}>
            <table className="tbl">
              <thead><tr><th>Player</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th></tr></thead>
              <tbody>
                {c.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="namecell">{r.label}</td>
                    <td className="num">{r.before.toLocaleString()}</td>
                    <td className="num">{r.after.toLocaleString()}</td>
                    <td className="num"><Delta d={r.change} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.note && <div className="viz__note">{c.note}</div>}
        </div>
      );
    default:
      return null;
  }
}
