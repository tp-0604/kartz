// Drive the real built app in a real browser against the real Worker code.
import { chromium } from 'playwright';

const URL_ = 'http://localhost:8788/';
const shot = n => new URL('../shots/' + n + '.png', import.meta.url).pathname;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : String(extra).slice(0, 300)); }
};

const TAG = 'Zephyr' + Date.now().toString(36).slice(-4);
// PLAYWRIGHT_CHROME points at a browser that is already on the machine; without it Playwright
// uses whichever one it installed itself.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROME ? { executablePath: process.env.PLAYWRIGHT_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(URL_, { waitUntil: 'networkidle' });

console.log('\n# the shell');
ok('two destinations', (await page.locator('.nav__item').allTextContents()).join(',') === 'Extract,Data',
   await page.locator('.nav__item').allTextContents());
ok('the extract screen is the landing', await page.locator('.extract').isVisible());
await page.screenshot({ path: shot('01-extract') });

console.log('\n# the data workspace');
await page.getByRole('button', { name: 'Data', exact: true }).click();
await page.waitForSelector('.grid__row', { timeout: 8000 });
ok('the rail lists boards', (await page.locator('.rail__item').count()) > 5);
ok('the grid has rows', (await page.locator('.grid__row').count()) > 5);
await page.screenshot({ path: shot('02-roster') });

// the grid should be using nearly the whole window
const box = await page.locator('.grid').boundingBox();
ok('the grid fills the viewport height', box.height > 700, JSON.stringify(box));
ok('the grid fills the width beside the rail', box.width > 1200, box);

console.log('\n# open a board');
await page.locator('.rail__item').filter({ hasText: '2026-09-04' }).first().click();
await page.waitForTimeout(600);
const headings = (await page.locator('.grid__th span').allTextContents()).filter(Boolean);
ok('a board shows the record columns', headings.slice(0, 5).join(',') === 'Rank,Player,Name in video,Alliance,Kartz Points', headings);
ok("a board's worth of rows", (await page.locator('.grid__row').count()) >= 20, await page.locator('.grid__row').count());

console.log('\n# editing a cell persists');
const cell = page.locator('.grid__row').nth(1).locator('.grid__cell').nth(4);
await cell.dblclick();
await page.keyboard.press('Control+a');
await page.keyboard.type('12345');
await page.keyboard.press('Enter');
await page.waitForTimeout(1400);
ok('the cell shows the new value', (await cell.innerText()).trim() === '12,345', await cell.innerText());
ok('the save state says saved', /Saved/.test(await page.locator('.ws__savestate').innerText()),
   await page.locator('.ws__savestate').innerText());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.grid__row', { timeout: 8000 });
await page.waitForTimeout(400);
const after = await page.locator('.grid__row').nth(1).locator('.grid__cell').nth(4).innerText();
ok('the edit survived a reload', after.trim() === '12,345', after);

console.log('\n# keyboard, selection and copy');
await page.locator('.grid__row').nth(0).locator('.grid__cell').nth(1).click();
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowRight');
ok('a rectangle is selected', (await page.locator('.grid__cell.is-sel').count()) === 6,
   await page.locator('.grid__cell.is-sel').count());
await page.waitForTimeout(150);
ok('the status bar counts the cells', /6 cells/.test(await page.locator('.ws__status').innerText()),
   await page.locator('.ws__status').innerText());
await page.keyboard.press('ArrowDown');
ok('an arrow collapses the selection', (await page.locator('.grid__cell.is-sel').count()) === 1);

console.log('\n# multi-row paste writes rows and creates the ones it runs past');
const rowCount = async () => +(await page.locator('.ws__status').innerText()).match(/([\d,]+)\s+rows/)[1].replace(/,/g, '');
const before = await rowCount();
// land on the last row, so one line overwrites it and the other becomes a new row
await page.locator('.grid').focus();
await page.keyboard.press('Control+ArrowDown');
await page.keyboard.press('Home');
await page.keyboard.press('ArrowRight');
await page.evaluate(tag => {
  const grid = document.querySelector('.grid');
  const dt = new DataTransfer();
  dt.setData('text/plain', `${tag}\t${tag}\t698N\t999\nQuark\tQuark\t698C\t888`);
  grid.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
}, TAG);
await page.waitForTimeout(1400);
ok('one row overwritten, one created', (await rowCount()) === before + 1, `${before} → ${await rowCount()}`);
ok('the pasted names are in the grid', (await page.locator('.grid').innerText()).includes(TAG));

console.log('\n# undo puts it back');
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
ok('undo removes the created row', (await rowCount()) === before, `${before} vs ${await rowCount()}`);
{
  const last = (await page.locator('.grid__row').allInnerTexts()).slice(-2).map(t => t.replace(/\n/g, ' | '));
  ok('undo removes the pasted value', !(await page.locator('.grid').innerText()).includes(TAG), last.join('  /  '));
}
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(1200);
ok('redo puts it back', (await rowCount()) === before + 1, await rowCount());
await page.screenshot({ path: shot('03-board') });

console.log('\n# search, filter, sort');
await page.locator('.findbox input').fill('Goose');
await page.waitForTimeout(300);
ok('search narrows the rows', (await page.locator('.grid__row').count()) === 1,
   await page.locator('.grid__row').count());
ok('the match is highlighted', (await page.locator('.grid__cell.is-hit').count()) >= 1);
await page.locator('.findbox input').fill('');
await page.waitForTimeout(200);

await page.locator('.grid__th').filter({ hasText: 'Kartz Points' }).first().click();
await page.waitForTimeout(250);
const first = await page.locator('.grid__row').nth(0).locator('.grid__cell').nth(4).innerText();
await page.locator('.grid__th').filter({ hasText: 'Kartz Points' }).first().click();
await page.waitForTimeout(250);
const second = await page.locator('.grid__row').nth(0).locator('.grid__cell').nth(4).innerText();
ok('sorting reverses', first !== second, `${first} then ${second}`);

console.log('\n# columns');
await page.getByRole('button', { name: /^Columns/ }).click();
await page.waitForTimeout(250);
await page.locator('.menu input[placeholder="New column…"]').fill('Notes');
await page.getByRole('button', { name: 'Add', exact: true }).click();
await page.waitForTimeout(900);
await page.keyboard.press('Escape');
ok('a new column appears', (await page.locator('.grid__th').allInnerTexts()).some(t => /notes/i.test(t)),
   await page.locator('.grid__th').allInnerTexts());
// The five typed columns are the app's, not the board's. Sending them back as the board's own
// columns used to duplicate every one of them under its own heading.
ok('and nothing else came with it', (await page.locator('.grid__th').count()) === 6,
   await page.locator('.grid__th').allInnerTexts());

console.log('\n# marking cells up');
const bgOf = loc => loc.evaluate(el => getComputedStyle(el).backgroundColor);
const YELLOW = /250,\s*240,\s*200/;                     // the light half of the yellow swatch
const marks = () => page.locator('.grid__cell.is-marked');
const points = r => page.locator('.grid__row').nth(r).locator('.grid__cell').nth(4);
await points(0).click();
await page.keyboard.press('Shift+ArrowDown');
await page.getByRole('button', { name: /Fill/ }).click();
await page.waitForTimeout(200);
await page.locator('.swatch[title="yellow"]').click();
await page.waitForTimeout(1200);
ok('the fill lands on both selected cells', (await marks().count()) === 2, await marks().count());
const filled = await bgOf(points(1));
ok('and it is actually yellow', YELLOW.test(filled), filled);
ok('a neighbouring cell is left alone', !YELLOW.test(await bgOf(points(2))));

// The menu took the focus when it was clicked; the grid has to have it back for this to land.
await page.keyboard.press('Control+b');
await page.waitForTimeout(1200);
ok('Ctrl+B bolds the selection',
   (await points(0).evaluate(el => getComputedStyle(el).fontWeight)) === '700',
   await points(0).evaluate(el => getComputedStyle(el).fontWeight));

// A reload drops the sort, so the marked rows come back wherever the stored order puts them —
// which is the point: the marking is on the row, not on the position.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.grid__row', { timeout: 8000 });
await page.waitForTimeout(500);
ok('the marking survived a reload', (await marks().count()) === 2, await marks().count());
ok('and it came back yellow', YELLOW.test(await bgOf(marks().first())), await bgOf(marks().first()));
await page.screenshot({ path: shot('03b-marked') });

await marks().first().click();
await page.getByRole('button', { name: /Fill/ }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Clear formatting' }).click();
await page.waitForTimeout(1200);
ok('clearing takes the marking off that cell', (await marks().count()) === 1, await marks().count());
await page.keyboard.press('Control+z');
await page.waitForTimeout(1200);
ok('and undo puts it back', (await marks().count()) === 2, await marks().count());

console.log('\n# the command palette');
await page.keyboard.press('Control+k');
await page.waitForTimeout(250);
ok('the palette opens', await page.locator('.palette').isVisible());
await page.locator('.palette input').fill('month');
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
ok('it goes to the month view', (await page.locator('.viewpane__head').innerText()).includes('Month across days'),
   await page.locator('.viewpane__head').innerText());
await page.screenshot({ path: shot('04-month') });

console.log('\n# the analyst degrades gracefully');
await page.locator('.rail__item').filter({ hasText: 'Roster' }).first().click();
await page.waitForTimeout(600);
const ask = page.locator('.askbar input');
ok('the ask bar is there', await ask.isVisible());
// Whether it is live depends on the Worker, and either answer has to be honest: switched off
// says why, switched on lets you type.
const aiOn = await page.evaluate(() => fetch('/api/ai/status').then(r => r.json()).then(j => j.available));
ok('the ask bar matches whether a provider is configured',
   (await ask.isDisabled()) === !aiOn, `provider ${aiOn ? 'on' : 'off'}, input ${await ask.isDisabled() ? 'disabled' : 'live'}`);
if (!aiOn) ok('and it says why', /switched off/.test(await ask.getAttribute('placeholder')),
              await ask.getAttribute('placeholder'));
ok('the grid works either way', (await page.locator('.grid__row').count()) >= 20);

console.log('\n# extract still loads');
await page.getByRole('button', { name: 'Extract', exact: true }).click();
await page.waitForTimeout(400);
ok('the three steps are there', (await page.locator('.step').allTextContents()).join('') === '123',
   await page.locator('.step').allTextContents());
ok('the roster count reaches it', (await page.locator('.rosterstate b').innerText()) === '20',
   await page.locator('.rosterstate b').innerText());

console.log('\n# console');
// The Google Fonts stylesheet cannot be fetched through this sandbox's proxy; that is the
// environment, not the app.
const real = errors.filter(e => !/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)/.test(e));
ok('no runtime errors in the console', real.length === 0, real.slice(0, 5).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
