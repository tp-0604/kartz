/**
 * The tests that need nothing installed.
 *
 *   node test/run.mjs
 *
 * Three suites, and between them the three things that break quietly: the door on the Worker,
 * what the model does when a provider is busy, and which column on a spreadsheet holds what.
 * No Cloudflare account, no network, no dependencies beyond Node itself.
 *
 * The dialog itself is looked at rather than tested:
 *
 *   cd web && npm run build
 *   node tools/serve-dialog.mjs              # the built dialog, framed the way Sheets frames it
 */
import { spawn } from 'node:child_process';

const SUITES = ['worker.test.mjs', 'providers.test.mjs', 'fields.test.mjs'];

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
