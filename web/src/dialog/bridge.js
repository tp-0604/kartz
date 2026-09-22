/**
 * Talking to the spreadsheet.
 *
 * Apps Script hands a page one object, `google.script.run`, whose calls take callbacks. Every
 * function in Sheets.gs is wrapped here as a promise, so the dialog can await the spreadsheet
 * the way it awaits everything else.
 *
 * Run outside Apps Script — `npm run dev`, or a browser opened on the built file — there is no
 * `google` at all. Rather than fail, the bridge answers from a small stand-in spreadsheet, so
 * the whole dialog can be built and looked at without leaving the machine. `inSheets()` says
 * which of the two you are in, and the UI says so too, because a stand-in that pretends to be
 * real is worse than no stand-in.
 *
 * `google.script.host` is the other half: a modeless dialog is a window, and a window can be
 * resized and closed from inside it. That is how the review gets more room than the start
 * screen needs.
 */

const g = typeof google !== 'undefined' ? google : null;
const host = g && g.script && g.script.run ? g.script.run : null;
const win = g && g.script && g.script.host ? g.script.host : null;

export const inSheets = () => !!host;

/* ------------------------------------------------------------------ the window itself */

let lastSize = null;

/**
 * Ask Google to make the dialog this big.
 *
 * Only a modeless dialog can do this; in a sidebar the call is simply not there, and outside
 * Sheets there is no `google` at all. Both cases do nothing rather than throw.
 *
 * The size asked for is trimmed to the screen first. A dialog taller than the window is not
 * scrolled or moved by Sheets — it is simply cut off at the bottom, buttons and all — and the
 * page cannot see the browser window from inside the sandbox, so the screen is the next best
 * thing: everything above and below the sheet comes off the top of it.
 */
const CHROME = { height: 300, width: 80 };

export function fit(width, height) {
  const scr = typeof screen !== 'undefined' ? screen : null;
  const h = scr && scr.availHeight ? scr.availHeight - CHROME.height : Infinity;
  const w = scr && scr.availWidth ? scr.availWidth - CHROME.width : Infinity;
  return {
    width: Math.round(Math.max(360, Math.min(width, w))),
    height: Math.round(Math.max(380, Math.min(height, h))),
  };
}

export function resize(width, height) {
  const size = fit(width, height);
  lastSize = size;
  if (!win) return false;
  try {
    win.setWidth(size.width);
    win.setHeight(size.height);
    return true;
  } catch { return false; }
}

/** Close the dialog from inside — the same thing Google's X does. */
export function close() {
  if (!win) return false;
  try { win.close(); return true; } catch { return false; }
}

export const askedSize = () => lastSize;

function call(name, ...args) {
  if (!host) return stub(name, args);
  return new Promise((resolve, reject) => {
    host.withSuccessHandler(resolve).withFailureHandler(err => {
      reject(new Error((err && err.message) || String(err)));
    })[name](...args);
  });
}

/* ----------------------------------------------------------------- what the sheet knows */

export const readCurrentSheet = () => call('readCurrentSheet');
export const readSelection = () => call('readSelection');
export const readRows = limit => call('readRows', limit);
export const readRoster = () => call('readRoster');
export const findDuplicates = (rows, keys) => call('findDuplicates', rows, keys);
export const insertRows = (rows, at) => call('insertRows', rows, at);
export const removeRows = (from, count) => call('removeRows', from, count);
export const appendLog = line => call('appendLog', line);
export const getWorker = () => call('getWorker');
export const setWorker = (url, pass) => call('setWorker', url, pass);
export const writeSettings = patch => call('writeSettings', patch);
export const readSettings = () => call('readSettings');

/* ------------------------------------------------------------------------ the stand-in */

const DEMO_ROSTER = [
  ['Nubi', 'ŊŲƁĮ', '698W'], ['Goose', 'GOOSE', '698W'], ['Glitter', 'Glitter', '698W'],
  ['BigMark', 'BigMark', '698W'], ['Neaira', 'Neaira', '698W'], ['Cutsnake', 'Cutsnake', '698W'],
  ['Eskimo', 'Eskimo❄️', '698W'], ['A west', 'A', '698W'], ['109NSA', '109NSA', '698W'],
  ['Aaron028', 'Aaron028', '698W'], ['Cein', 'Cein🌟', '698N'], ['Amcia', 'Amcia', '698C'],
].map(([search, ingame, alliance], i) => ({ search, ingame, alliance, row: i + 2 }));

const settings = { rosterTab: 'Roster' };
let fakeRows = 41;

function stub(name, args) {
  const wait = out => new Promise(r => setTimeout(() => r(out), 260));
  switch (name) {
    case 'readCurrentSheet':
      return wait({
        spreadsheet: 'TW 2698 — Kartz Tracking (stand-in)',
        sheet: 'September 2026', sheetId: 1,
        tabs: ['September 2026', 'August 2026', 'Roster', 'Kartz log'],
        headers: ['Place', 'Searchable Name', 'Game Name', 'Alliance', 'Points', 'Date'],
        headerRow: 1, lastRow: fakeRows, lastCol: 6, rows: fakeRows - 1,
        canEdit: true, frozenRows: 1,
      });
    case 'readSelection':
      return wait({ sheet: 'September 2026', row: 18, column: 2, a1: 'B18', rows: 1 });
    case 'readRows':
      return wait({
        sheet: 'September 2026',
        headers: ['Place', 'Searchable Name', 'Game Name', 'Alliance', 'Points', 'Date'],
        rows: DEMO_ROSTER.slice(0, 8).map((p, i) => [
          i + 1, p.search, p.ingame, p.alliance, 600 - i * 24, '2026-09-15',
        ]),
        total: fakeRows - 1,
      });
    case 'readRoster':
      return wait({ ok: true, tab: settings.rosterTab, rows: DEMO_ROSTER, count: DEMO_ROSTER.length });
    case 'findDuplicates':
      // Pretend the first row is already there, so the duplicate path can be seen.
      return wait({ duplicates: (args[0] || []).length ? [{ index: 0, row: 12 }] : [], scanned: fakeRows - 1 });
    case 'insertRows': {
      const rows = args[0] || [];
      const from = fakeRows + 1;
      fakeRows += rows.length;
      return wait({ written: rows.length, from, to: fakeRows, sheet: 'September 2026' });
    }
    case 'removeRows':
      fakeRows -= Number(args[1]) || 0;
      return wait({ removed: Number(args[1]) || 0 });
    case 'appendLog': return wait(true);
    case 'getWorker': return wait({ url: '', pass: '', hasPass: false });
    case 'setWorker': return wait({ url: args[0], pass: args[1], hasPass: !!args[1] });
    case 'readSettings': return wait({ ...settings });
    case 'writeSettings': Object.assign(settings, args[0] || {}); return wait({ ...settings });
    default: return Promise.reject(new Error('no stand-in for ' + name));
  }
}
