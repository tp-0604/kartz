/**
 * Everything that touches the spreadsheet.
 *
 * Five jobs, and one rule that governs all of them: never write a cell you were not asked to
 * write. Values go in with setValues over a range sized to the values; formatting is inherited
 * rather than set, so conditional formats, dropdowns, banding and column widths keep working
 * without this script knowing they exist. Nothing here clears, formats or sorts anything.
 */

/* -------------------------------------------------------------------- what is on screen */

/**
 * The tab the cursor is in: its headings, how far down the rows go, and what the dialog needs
 * to know to put new rows in the right place.
 */
function readCurrentSheet() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(1, sheet.getLastColumn());

  var headers = [];
  var headerRow = 0;
  if (lastRow > 0) {
    // The heading row is the first one with two or more words in it — these sheets often open
    // with a title, a blank line, and only then the headings.
    var top = sheet.getRange(1, 1, Math.min(lastRow, 12), lastCol).getDisplayValues();
    for (var r = 0; r < top.length; r++) {
      var filled = top[r].filter(function (v) { return String(v).trim() !== ''; });
      if (filled.length >= 2) { headers = top[r]; headerRow = r + 1; break; }
    }
  }

  return {
    spreadsheet: ss.getName(),
    sheet: sheet.getName(),
    sheetId: sheet.getSheetId(),
    tabs: sheetNames(),
    headers: headers.map(function (h) { return String(h).trim(); }),
    headerRow: headerRow,
    lastRow: lastRow,
    lastCol: lastCol,
    rows: Math.max(0, lastRow - headerRow),
    canEdit: canEdit(),
    frozenRows: sheet.getFrozenRows()
  };
}

/**
 * Where the cursor is, right now.
 *
 * Only a modeless dialog has any use for this: the spreadsheet stays live while the window is
 * open, so the person can click a cell and mean "put them here". Cheap enough to ask for every
 * few seconds, and it never changes anything.
 */
function readSelection() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getActiveSheet();
  var range = sheet.getActiveRange();
  if (!range) return { sheet: sheet.getName(), row: 0, column: 0, a1: '', rows: 0 };
  return {
    sheet: sheet.getName(),
    row: range.getRow(),
    column: range.getColumn(),
    a1: range.getA1Notation(),
    rows: range.getNumRows()
  };
}

/**
 * The rows on this tab, for a question about them.
 *
 * Display values, not underlying ones, because a question about a sheet is a question about
 * what the sheet shows. Nothing is written and nothing is kept; the rows go with the question
 * and the answer comes back.
 */
function readRows(limit) {
  var here = readCurrentSheet();
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var want = Math.max(1, Math.min(Number(limit) || 300, 2000));
  var first = here.headerRow + 1;
  var total = Math.max(0, here.lastRow - here.headerRow);
  var take = Math.min(want, total);
  var rows = take > 0
    ? sheet.getRange(first, 1, take, here.lastCol).getDisplayValues()
    : [];
  return {
    spreadsheet: here.spreadsheet,
    sheet: here.sheet,
    headers: here.headers,
    rows: rows,
    total: total
  };
}

/** Whether the person looking at this may write to it. Google decides; this only asks. */
function canEdit() {
  try {
    var ss = SpreadsheetApp.getActive();
    // A viewer cannot see the protections list, which is itself the answer.
    ss.getActiveSheet().getRange(1, 1).getValue();
    var me = Session.getEffectiveUser().getEmail();
    var editors = ss.getEditors().map(function (u) { return u.getEmail(); });
    if (!me) return true;                       // no identity to compare: let the write fail loudly
    return ss.getOwner() && ss.getOwner().getEmail() === me
      || editors.indexOf(me) !== -1;
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------------- the roster */

var ROSTER_GUESSES = ['roster', 'input-roster', 'inputroster', 'players', 'members', 'alliance rosters'];

/** Which tab holds the roster: the one that was chosen, or the first that looks like one. */
function findRosterTab() {
  var chosen = readSettings().rosterTab;
  var ss = SpreadsheetApp.getActive();
  if (chosen) {
    var byName = ss.getSheetByName(chosen);
    if (byName) return byName;
  }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().toLowerCase().replace(/[^a-z -]/g, '').trim();
    if (ROSTER_GUESSES.indexOf(name) !== -1) return sheets[i];
  }
  // Failing a name, a tab whose headings mention a name and an alliance.
  for (var j = 0; j < sheets.length; j++) {
    var head = sheets[j].getRange(1, 1, 1, Math.min(12, Math.max(1, sheets[j].getLastColumn())))
      .getDisplayValues()[0].join(' ').toLowerCase();
    if (/name/.test(head) && /alliance/.test(head)) return sheets[j];
  }
  return null;
}

/**
 * The roster, as the extractor wants it: a searchable name, the name the game draws, and an
 * alliance. Which column is which is worked out from the headings, because every one of these
 * sheets names them differently.
 */
function readRoster() {
  var sheet = findRosterTab();
  if (!sheet) {
    return { ok: false, reason: 'No roster tab found. Kartz → Which tabs am I using? to pick one.',
             tabs: sheetNames() };
  }
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(1, sheet.getLastColumn());
  if (lastRow < 2) return { ok: false, reason: 'The tab "' + sheet.getName() + '" has no rows in it.' };

  var values = sheet.getRange(1, 1, Math.min(lastRow, 5000), lastCol).getDisplayValues();
  var headers = values[0].map(function (h) { return String(h).toLowerCase(); });

  var find = function (tests) {
    for (var i = 0; i < headers.length; i++) {
      for (var t = 0; t < tests.length; t++) if (tests[t].test(headers[i])) return i;
    }
    return -1;
  };
  var searchAt = find([/search/, /^name$/, /roster name/]);
  var ingameAt = find([/in ?game/, /game name/, /^display/]);
  var allianceAt = find([/alliance/, /^team$/]);
  if (searchAt === -1 && ingameAt === -1) {
    return { ok: false, reason: 'The tab "' + sheet.getName() + '" has no name column I can find.',
             headers: values[0] };
  }

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var search = searchAt === -1 ? '' : String(values[r][searchAt] || '').trim();
    var ingame = ingameAt === -1 ? '' : String(values[r][ingameAt] || '').trim();
    if (!search && !ingame) continue;
    rows.push({
      search: search || ingame,
      ingame: ingame || search,
      alliance: allianceAt === -1 ? '' : String(values[r][allianceAt] || '').trim(),
      row: r + 1
    });
  }
  return { ok: true, tab: sheet.getName(), rows: rows, count: rows.length,
           columns: { search: searchAt, ingame: ingameAt, alliance: allianceAt } };
}

/* --------------------------------------------------------------------- already there? */

/**
 * Which of these rows the sheet already holds.
 *
 * A row is the same row when its key matches — by default the name, and whatever else the
 * caller says makes a row unique on this sheet, usually a date. Comparison is done on what the
 * cells *show*, not what they hold, so a date formatted two ways still matches.
 */
function findDuplicates(candidates, keyColumns) {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(1, sheet.getLastColumn());
  if (lastRow < 2 || !candidates || !candidates.length) return { duplicates: [], scanned: 0 };

  var values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });

  var keys = (keyColumns && keyColumns.length ? keyColumns : ['name']).map(function (k) {
    return String(k).trim().toLowerCase();
  });
  var at = keys.map(function (k) {
    for (var i = 0; i < headers.length; i++) if (headers[i].indexOf(k) !== -1) return i;
    return -1;
  }).filter(function (i) { return i !== -1; });
  if (!at.length) return { duplicates: [], scanned: values.length - 1, note: 'no key column matched' };

  var seen = {};
  for (var r = 1; r < values.length; r++) {
    var key = at.map(function (i) { return norm(values[r][i]); }).join(' ');
    if (key.replace(/ /g, '') === '') continue;
    if (!seen[key]) seen[key] = r + 1;
  }

  var out = [];
  for (var c = 0; c < candidates.length; c++) {
    var cand = candidates[c];
    var candKey = keys.map(function (k) { return norm(cand[k] !== undefined ? cand[k] : ''); }).join(' ');
    if (seen[candKey]) out.push({ index: c, row: seen[candKey] });
  }
  return { duplicates: out, scanned: values.length - 1, keys: keys };
}

/** What "the same" means: case, spacing and the fancy text the game draws do not count. */
function norm(v) {
  return String(v === null || v === undefined ? '' : v)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/* --------------------------------------------------------------------- writing rows */

/**
 * Put rows into the sheet without disturbing it.
 *
 *   `rows`    values, already in the order the headings are in
 *   `at`      'end' to append, or a row number to insert above
 *
 * New rows are inserted rather than written over, and take their formatting from the row above
 * — which is how a sheet's conditional formats, dropdowns and banding keep working. Only the
 * value range is written; nothing else on the sheet is touched.
 */
function insertRows(rows, at) {
  if (!canEdit()) throw new Error('You can view this spreadsheet but not change it.');
  if (!rows || !rows.length) return { written: 0 };

  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var width = rows.reduce(function (n, r) { return Math.max(n, r.length); }, 0);
  if (!width) return { written: 0 };
  if (sheet.getMaxColumns() < width) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  }

  var lastRow = sheet.getLastRow();
  var after = (at === 'end' || !at) ? lastRow : Math.max(1, Number(at) - 1);
  if (after < 1) after = 1;

  sheet.insertRowsAfter(after, rows.length);
  var target = sheet.getRange(after + 1, 1, rows.length, width);

  // Formatting comes from the row above, explicitly, so the rows look like their neighbours
  // whatever the sheet does with banding or conditional formats.
  if (after >= 1 && sheet.getLastRow() >= after) {
    sheet.getRange(after, 1, 1, width)
      .copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }

  // Values last, and only values: a rectangle the size of what was asked for.
  var padded = rows.map(function (r) {
    var out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
  target.setValues(padded);

  SpreadsheetApp.flush();
  return { written: rows.length, from: after + 1, to: after + rows.length, sheet: sheet.getName() };
}

/**
 * One sentence about what just happened, appended to a log tab.
 *
 * The tab is made if it is not there. It is the only tab this script will create, and it holds
 * nothing but a time, a person and a line of words.
 */
function appendLog(line) {
  var ss = SpreadsheetApp.getActive();
  var tab = ss.getSheetByName('Kartz log');
  if (!tab) {
    tab = ss.insertSheet('Kartz log', ss.getSheets().length);
    tab.getRange(1, 1, 1, 3).setValues([['When', 'Who', 'What']]);
    tab.setFrozenRows(1);
    tab.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  var who = '';
  try { who = Session.getActiveUser().getEmail() || ''; } catch (err) { who = ''; }
  tab.appendRow([new Date(), who, String(line || '')]);
  return true;
}

/** Undo: take back exactly the rows just written, and nothing else. */
function removeRows(from, count) {
  if (!canEdit()) throw new Error('You can view this spreadsheet but not change it.');
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var n = Math.max(0, Number(count) || 0);
  if (!n) return { removed: 0 };
  sheet.deleteRows(Number(from), n);
  SpreadsheetApp.flush();
  return { removed: n };
}
