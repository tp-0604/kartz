/**
 * The tests that need nothing installed.
 *
 *   node test/run.mjs
 *
 * They run the real Worker — routing, the data layer, the controlled tools the analyst uses —
 * against a real SQLite database standing in for D1, and the .xlsx writer against the .xlsx
 * reader. No Cloudflare account, no network, no dependencies beyond Node itself.
 *
 * The two browser suites need the app built and a browser, and are run separately:
 *
 *   cd web && BASE_PATH=/ npm run build
 *   node test/serve.mjs &                    # the built app + the Worker, on :8788
 *   node test/browser.test.mjs               # the workspace, the grid, editing, undo
 *   node test/stub-model.mjs &               # a stand-in provider, on :8799
 *   AI_PROVIDER=openai OPENAI_API_KEY=x AI_GATEWAY=http://localhost:8799 node test/serve.mjs &
 *   node test/browser-ai.test.mjs            # the analyst, the charts, the validation
 */
import { spawn } from 'node:child_process';

const SUITES = ['worker.test.mjs', 'tools.test.mjs', 'export.test.mjs', 'sheet.test.mjs'];

let failed = 0;
for (const suite of SUITES) {
  console.log('\n── ' + suite + ' ' + '─'.repeat(Math.max(0, 60 - suite.length)));
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--no-warnings', new URL(suite, import.meta.url).pathname],
                        { stdio: 'inherit' });
    child.on('exit', resolve);
  });
  if (code) failed++;
}

console.log(failed ? `\n${failed} suite${failed > 1 ? 's' : ''} failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
