/**
 * Getting data back out: a CSV, or a real .xlsx.
 *
 * The reader in xlsx.js exists because a spreadsheet library costs the best part of a megabyte
 * to do what a scanner over some XML does. The writer is the same bargain from the other side:
 * an .xlsx is a zip of five small files, and fflate — already here for reading — zips it.
 */
import { extraName, isExtra } from '../data/model.js';

const cell = v => {
  const t = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

/** Columns and rows to a CSV, with the BOM Excel wants before it will believe UTF-8. */
export function toCsv(columns, rows, { bom = true } = {}) {
  const lines = [columns.map(c => cell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map(c => cell(r[c.key])).join(','));
  return (bom ? '﻿' : '') + lines.join('\r\n');
}

const xmlEscape = s => String(s).replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));

// "BC" from 54. The only place a spreadsheet uses a base-26 without a zero.
function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

function sheetXml(columns, rows) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    '<cols>' + columns.map((c, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.min(60, Math.round((c.width || 130) / 7)))}" customWidth="1"/>`).join('') + '</cols>',
    '<sheetData>',
    '<row r="1">' + columns.map((c, i) =>
      `<c r="${colLetter(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(c.header)}</t></is></c>`).join('') + '</row>',
  ];
  rows.forEach((row, r) => {
    const cells = columns.map((c, i) => {
      const v = row[c.key];
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colLetter(i)}${r + 2}`;
      return typeof v === 'number' && Number.isFinite(v)
        ? `<c r="${ref}"><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
    }).join('');
    out.push(`<row r="${r + 2}">${cells}</row>`);
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  + '</Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  + '</Relationships>';

const WB_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

// Two styles: the default, and a bold one for the heading row.
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '</styleSheet>';

const workbookXml = name => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + `<sheets><sheet name="${xmlEscape(name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets>`
  + '</workbook>';

/** Columns and rows to an .xlsx, as a Blob. */
export async function toXlsx(columns, rows, sheetName = 'Data') {
  const { zipSync, strToU8 } = await import('fflate');
  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'xl/workbook.xml': strToU8(workbookXml(sheetName)),
    'xl/_rels/workbook.xml.rels': strToU8(WB_RELS),
    'xl/styles.xml': strToU8(STYLES),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml(columns, rows)),
  };
  return new Blob([zipSync(files, { level: 6 })],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safe = s => String(s || 'kartz').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'kartz';

/**
 * Export what is on screen, or everything, or the rows that are selected. The columns are the
 * visible ones in their current order, so the file matches what the user is looking at — and a
 * column the app has never understood goes out under its own heading like any other.
 */
export async function exportDataset({ format, columns, rows, name }) {
  const cols = columns.filter(c => !c.hidden);
  const file = `${safe(name)}-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'xlsx') {
    download(await toXlsx(cols, rows, safe(name)), file + '.xlsx');
    return;
  }
  download(new Blob([toCsv(cols, rows)], { type: 'text/csv;charset=utf-8' }), file + '.csv');
}

/** Rows as records the Worker's whole-board and roster routes accept. */
export function toRecords(columns, rows, kind) {
  return rows.map(r => {
    const extra = {};
    for (const c of columns) if (isExtra(c.key) && r[c.key]) extra[extraName(c.key)] = String(r[c.key]);
    return kind === 'roster'
      ? { id: r.id, search: r.search, ingame: r.ingame, alliance: r.alliance, extra }
      : { place: r.place, search: r.search, ingame: r.ingame, alliance: r.alliance,
          points: r.points, edited: r.edited, extra };
  });
}
