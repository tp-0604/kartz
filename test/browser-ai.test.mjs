// The analytics path, end to end: the panel asks, the Worker runs the tools against SQLite, the
// answer is validated, and this application draws it.
import { chromium } from 'playwright';
const shot = n => new URL('../shots/' + n + '.png', import.meta.url).pathname;
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, String(e ?? '').slice(0, 300)); } };

// PLAYWRIGHT_CHROME points at a browser that is already on the machine; without it Playwright
// uses whichever one it installed itself.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROME ? { executablePath: process.env.PLAYWRIGHT_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:8788/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Data', exact: true }).click();
await page.waitForSelector('.grid__row');
await page.locator('.rail__item').filter({ hasText: '2026-09-04' }).first().click();
await page.waitForTimeout(600);

const ask = page.locator('.askbar input');
ok('the ask bar is live when a provider is configured', !(await ask.isDisabled()));
await ask.click();
await page.waitForTimeout(300);
ok('the panel opens with example questions', (await page.locator('.aiexamples button').count()) >= 4);
await page.screenshot({ path: shot('05-ai-empty') });

await ask.fill('Which alliance has the highest average score?');
await page.keyboard.press('Enter');
await page.waitForSelector('.answer__title', { timeout: 20000 });
await page.waitForTimeout(500);

ok('a title comes back', (await page.locator('.answer__title').innerText()).length > 3,
   await page.locator('.answer__title').innerText());
ok('metrics render', (await page.locator('.kpi').count()) === 2, await page.locator('.kpi').count());
ok('a bar chart renders with a bar per alliance', (await page.locator('.chart .chart__bar').count()) === 4,
   await page.locator('.chart .chart__bar').count());
ok('a line chart renders', (await page.locator('.chart .series-line').count()) === 1);
ok('a table renders', (await page.locator('.answer table.tbl').count()) >= 1);
ok('an unknown component type was dropped', !(await page.locator('.aipanel').innerText()).includes('should be dropped'));
ok('no script reached the page', (await page.locator('.aipanel script').count()) === 0);
ok('sources are shown', (await page.locator('.source').count()) === 2, await page.locator('.source').count());
ok('the answer says it is measured', /measured/i.test(await page.locator('.answer__flag').innerText()),
   await page.locator('.answer__flag').innerText());

await page.locator('.answer .disclosure summary').click();
await page.waitForTimeout(200);
const log = await page.locator('.ailog').innerText();
ok('the tool trace is shown', /aggregate_records/.test(log) && /get_trend/.test(log), log.replace(/\n/g, ' | '));
ok('a refused tool call is shown as refused', /✗/.test(log), log.replace(/\n/g, ' | '));
await page.screenshot({ path: shot('06-ai-answer') });

// the chart's own relief: the numbers behind it
await page.locator('.viz__toggle').first().click();
await page.waitForTimeout(200);
ok('a chart can show its numbers', (await page.locator('.viz .tablewrap').count()) >= 1);

// "view source data" takes the workspace somewhere
const grip = await page.locator('.aipanel').boundingBox();
ok('the panel is beside the grid, not over it', grip.x > 900, JSON.stringify(grip));
await page.locator('.aipanel__head button').click();
await page.waitForTimeout(300);
ok('the panel closes and the grid takes the width back',
   (await page.locator('.aipanel').count()) === 0 && (await page.locator('.grid').boundingBox()).width > 1200);

ok('no runtime errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
