/**
 * Kartz — read a screen recording into this spreadsheet.
 *
 * The menu, the window, and the few things the window cannot do for itself. Everything that
 * touches the spreadsheet lives in Sheets.gs; everything that touches the video, the model and
 * the reviewing lives in the dialog, which is a web page.
 *
 * The dialog is modeless: it floats over the spreadsheet and leaves it live underneath, so you
 * can scroll the sheet, click a cell, or switch tabs while it is open. That is the difference
 * between showModelessDialog and showModalDialog, and it is the whole reason this is a dialog
 * rather than a sidebar — a sidebar is stuck at three hundred pixels, and a modal one takes
 * the spreadsheet away from you while it is up.
 *
 * Nothing here ever sees the recording. The dialog reads it in the browser, sends frames to
 * the Worker, and hands back finished rows — so this script stays well inside Apps Script's
 * quotas and never has to hold a fifty-megabyte file.
 *
 * Who may do what is Google's business: if you can edit the spreadsheet you can extract into
 * it, and if you can only view it the dialog says so and stops. There are no accounts here.
 */

/** Kartz appears on the menu bar next to Help, and under Extensions. */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('Kartz')
    .addItem('Extract a recording', 'showDialog')
    .addSeparator()
    .addItem('Which tabs am I using?', 'showSettings')
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

/**
 * The window.
 *
 * Modeless, so the spreadsheet underneath stays usable: you can drag this by its title bar,
 * scroll the sheet behind it, click a cell, and the dialog notices. The size here is only the
 * opening size — the page asks for more room for the review with google.script.host.setWidth
 * and setHeight, which is a thing only a dialog can do.
 *
 * One dialog exists at a time; calling this again brings up a fresh one in place of the old.
 */
function showDialog() {
  var html = HtmlService.createHtmlOutputFromFile('Dialog')
    .setWidth(760)
    .setHeight(548);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Kartz');
}

/** Which tab the roster is on, and which one rows go into. Kept per spreadsheet, not per person. */
function showSettings() {
  var s = readSettings();
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt(
    'Kartz — the roster tab',
    'Rows are matched against a roster. Which tab is it on?\n\n'
      + 'Now: ' + (s.rosterTab || 'found automatically') + '\n'
      + 'Tabs here: ' + sheetNames().join(', ') + '\n\n'
      + 'Type a tab name, or leave blank to find it automatically.',
    ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var name = String(answer.getResponseText() || '').trim();
  writeSettings({ rosterTab: name || null });
  SpreadsheetApp.getActive().toast(name ? 'Roster: ' + name : 'Roster found automatically', 'Kartz', 4);
}

/* ------------------------------------------------------------------- what the dialog asks for */

var SETTINGS_KEY = 'kartz.settings';

function readSettings() {
  try {
    var raw = PropertiesService.getDocumentProperties().getProperty(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function writeSettings(patch) {
  var now = readSettings();
  for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) now[k] = patch[k];
  PropertiesService.getDocumentProperties().setProperty(SETTINGS_KEY, JSON.stringify(now));
  return now;
}

function sheetNames() {
  return SpreadsheetApp.getActive().getSheets().map(function (s) { return s.getName(); });
}

/**
 * Where the Worker is, and the phrase that proves this spreadsheet may use it.
 *
 * The phrase is a document property rather than a line in this file: it is set once, from the
 * dialog, and everyone who opens the spreadsheet afterwards gets it without being told it.
 *
 * It is handed to the dialog's page, which needs it — the frames of a recording go from the
 * browser straight to the Worker, and fifty megabytes of them could not be relayed through
 * Apps Script in any case. That is as private as the spreadsheet: only somebody Google already
 * lets edit this file can open the dialog at all. Anybody who should not have the phrase should
 * not have edit access, and the phrase can be changed here without touching the Worker's key.
 */
function getWorker() {
  var s = readSettings();
  return {
    url: s.workerUrl || 'https://kartz.tpoonawala0604.workers.dev',
    pass: s.workerPass || '',
    hasPass: !!s.workerPass
  };
}

function setWorker(url, pass) {
  writeSettings({
    workerUrl: String(url || '').replace(/\/+$/, '') || null,
    workerPass: pass === null || pass === undefined ? undefined : String(pass)
  });
  return getWorker();
}
