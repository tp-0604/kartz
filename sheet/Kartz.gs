/**
 * Kartz — pull scores from the extractor into this workbook.
 *
 * Paste this into Extensions → Apps Script, save, and reload the sheet. A "Kartz" menu appears
 * next to Help.
 *
 * The token below opens one route on the Worker: a read of the scores table. It cannot write
 * anything and cannot reach the model, so it is safe to leave in a script that everyone with
 * the workbook can open. It is not the same secret as SHARED_PASS, which opens everything and
 * should never be pasted anywhere.
 */
const KARTZ_URL   = 'https://kartz.tpoonawala0604.workers.dev/api/csv';
const KARTZ_TOKEN = 'dvWJKfNIvrLQlAYgQGjrJGMs4ZT3W35P';

/**
 * Which tab gets what. A tab is a name and a filter, and the filters are the same words the
 * URL takes — alliance, month, player, date — so a new tab is one line here rather than any
 * new code. Leave the filter empty for everything.
 */
const KARTZ_TABS = [
  { tab: 'Kartz — all',  filter: {} },
  { tab: 'Kartz — 698W', filter: { alliance: '698W' } },
  { tab: 'Kartz — 698S', filter: { alliance: '698S' } },
  { tab: 'Kartz — 698N', filter: { alliance: '698N' } },
  { tab: 'Kartz — 698C', filter: { alliance: '698C' } },
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Kartz')
    .addItem('Update all tabs', 'kartzUpdateAll')
    .addItem('Update this tab', 'kartzUpdateActive')
    .addToUi();
}

/** Every tab in the list above, in one go. */
function kartzUpdateAll() {
  let total = 0;
  KARTZ_TABS.forEach(function (t) { total += kartzFill(t.tab, t.filter); });
  SpreadsheetApp.getActive().toast(total + ' rows written', 'Kartz', 5);
}

/** Just the tab you are looking at, if it is one of the ones listed. */
function kartzUpdateActive() {
  const name = SpreadsheetApp.getActiveSheet().getName();
  const spec = KARTZ_TABS.filter(function (t) { return t.tab === name; })[0];
  if (!spec) {
    SpreadsheetApp.getUi().alert('"' + name + '" is not one of the Kartz tabs. Add it to '
      + 'KARTZ_TABS in the script, or use Update all tabs.');
    return;
  }
  const n = kartzFill(spec.tab, spec.filter);
  SpreadsheetApp.getActive().toast(n + ' rows written to ' + name, 'Kartz', 5);
}

/**
 * Replace one tab's contents with what the extractor holds.
 *
 * The old rows are cleared before the new ones land, so this is repeatable: running it twice
 * leaves the same sheet rather than two copies. Only the block this script owns is touched —
 * anything to the right of the last column is left alone, so formulas and notes beside the
 * data survive an update.
 */
function kartzFill(tabName, filter) {
  const params = Object.keys(filter || {})
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(filter[k]); });
  const url = KARTZ_URL + (params.length ? '?' + params.join('&') : '');

  const res = UrlFetchApp.fetch(url, {
    headers: { 'x-kartz-token': KARTZ_TOKEN },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200)
    throw new Error('Kartz: ' + res.getResponseCode() + ' — ' + res.getContentText().slice(0, 200));

  const rows = Utilities.parseCsv(res.getContentText());
  if (!rows.length) return 0;

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  const width = rows[0].length;
  if (sh.getLastRow() > 0)
    sh.getRange(1, 1, sh.getLastRow(), Math.max(width, sh.getLastColumn())).clearContent();
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
  return rows.length - 1;                       // not counting the header
}
