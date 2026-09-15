// A stand-in for a model provider, speaking the OpenAI wire shape.
//
// It exists so the whole analytics path can be exercised for real: the Worker's tool loop runs,
// the tools query SQLite, the results come back, the response schema is validated and the panel
// draws it. What it does not test is whether a real model picks good arguments — only that every
// piece around it works.
import http from 'node:http';


http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const hasTools = Array.isArray(body.tools) && body.tools.length;
  // Stateless: what has already come back decides what to say next.
  const answered = (body.messages || []).some(m => m.role === 'tool');

  const reply = msg => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }] }));
  };

  if (hasTools && !answered) {
    return reply({ role: 'assistant', content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'aggregate_records',
        arguments: JSON.stringify({ dataset: 'scores', metric: 'avg', field: 'points', groupBy: 'alliance' }) } },
      { id: 'c2', type: 'function', function: { name: 'get_trend',
        arguments: JSON.stringify({ metric: 'avg', alliance: '698W', by: 'board' }) } },
      { id: 'c3', type: 'function', function: { name: 'query_records',
        arguments: JSON.stringify({ dataset: 'scores', columns: ['search', 'points'],
                                    sort: { field: 'points', direction: 'desc' }, limit: 5 }) } },
      { id: 'c4', type: 'function', function: { name: 'query_records',
        arguments: JSON.stringify({ dataset: 'scores', columns: ['nonexistent'] }) } },
    ] });
  }
  if (hasTools) return reply({ role: 'assistant', content: 'I have what I need.' });

  // The render pass: the shape the panel draws, plus two components it must refuse.
  const last = body.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));
  const groups = (last.find(r => r.groups) || {}).groups || [];
  const points = (last.find(r => r.points) || {}).points || [];
  const top = (last.find(r => Array.isArray(r.rows) && r.rows[0] && 'search' in r.rows[0]) || {}).rows || [];

  return reply({ role: 'assistant', content: JSON.stringify({
    title: 'Average score by alliance',
    summary: `698W averages ${Math.round((groups[0] || {}).value || 0).toLocaleString()} points across `
      + `${(groups[0] || {}).rows || 0} rows. One tool call was refused because the column does not exist.`,
    confidence: 'measured',
    components: [
      { type: 'metric', label: 'Highest average', value: Math.round((groups[0] || {}).value || 0), unit: 'pts',
        delta: 412, deltaLabel: 'vs the board before' },
      { type: 'metric', label: 'Alliances', value: groups.length },
      { type: 'bar_chart', title: 'Average points by alliance', x: 'alliance', y: 'average points',
        rows: groups.map(g => ({ label: g.group, value: Math.round(g.value) })) },
      { type: 'line_chart', title: '698W across its boards', x: 'board', y: 'average points',
        series: [{ name: '698W average', points: points.map(p => ({ x: p.period, y: p.value })) }] },
      { type: 'table', title: 'Top five scores', columns: ['Player', 'Points'],
        rows: top.map(r => [r.search, r.points]) },
      { type: 'danger', title: 'should be dropped', html: '<script>alert(1)</script>' },
      { type: 'text', text: 'A component type this app does not know was dropped before it got here.' },
    ],
    sources: [
      { label: 'every board saved', dataset: 'scores', rows: (groups[0] || {}).rows || 0 },
      { label: '698W across its boards', dataset: 'scores', rows: points.length },
    ],
  }) });
}).listen(8799, () => console.log('stub model on 8799'));
