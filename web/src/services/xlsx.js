// Reading an .xlsx in the browser, without a spreadsheet library.
//
// An .xlsx is a zip of XML, and the part of it this app needs is small: the sheet names, the
// shared string table, and the cells. fflate unzips (30 KB, MIT); the rest is a scanner over
// the sheet XML. SheetJS would do the same job and cost about nine hundred kilobytes, and the
// version on the public npm registry is several years and two advisories behind the one its
// authors actually publish.
//
// Two passes over the zip. The first takes only the little metadata files and works out which
// sheet is which; the second decompresses only the sheets asked for. This workbook is 28 MB
// unpacked and a third of that is one scratch tab nobody wants, so skipping by name is worth
// the extra pass.

const dec = new TextDecoder();

// Entities, including the numeric forms Google emits for emoji and exotic scripts.
function unescapeXml(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(?:(amp|lt|gt|quot|apos)|#(x?)([0-9a-fA-F]+));/g, (_, name, hex, code) => {
    if (name) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name];
    const n = parseInt(code, hex ? 16 : 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : '';
  });
}

// "BC" -> 54. Column letters are the only place xlsx uses a base-26 without a zero.
function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

// The shared string table: one entry per <si>, whose text may arrive in several <t> runs.
function readSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  const si = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = si.exec(xml))) {
    let text = '';
    const t = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = t.exec(m[1]))) text += tm[1];
    out.push(unescapeXml(text));
  }
  return out;
}

// One sheet, as a rectangular array. Values are numbers or strings; a formula contributes its
// cached result, which is what the file records and what the sheet showed when it was saved.
//
// Google pads a tab to twenty thousand styled but empty rows, so the scan gives up after a
// long run of nothing rather than walking all of them.
const BLANK_RUN = 300;

function readSheet(xml, shared, maxRows = 60000) {
  const rows = [];
  let blank = 0;
  const rowRe = /<row[^>]*?\sr="(\d+)"[^>]*?(\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowNum = +rm[1];
    if (rowNum > maxRows) break;
    const body = rm[3];
    if (!body) { blank++; if (blank > BLANK_RUN) break; continue; }
    const cells = [];
    let any = false;
    const cellRe = /<c[^>]*?\sr="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(body))) {
      const idx = colIndex(cm[1]);
      const attrs = cm[2] || '';
      const inner = cm[3];
      if (inner === undefined || inner === '') continue;
      const type = (attrs.match(/\st="([^"]+)"/) || [])[1] || 'n';
      let value;
      if (type === 'inlineStr') {
        let text = '';
        const t = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = t.exec(inner))) text += tm[1];
        value = unescapeXml(text);
      } else {
        // <f> is the formula; <v> is what it last evaluated to, which is the answer we want.
        const v = (inner.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1];
        if (v === undefined) continue;
        if (type === 's') value = shared[+v] ?? '';
        else if (type === 'b') value = v === '1';
        else if (type === 'e') continue;                    // #N/A and friends are not data
        else if (type === 'str') value = unescapeXml(v);
        else { const n = +v; value = Number.isFinite(n) ? n : unescapeXml(v); }
      }
      if (value === '' || value === null) continue;
      cells[idx] = value;
      any = true;
    }
    if (!any) { blank++; if (blank > BLANK_RUN) break; continue; }
    blank = 0;
    while (rows.length < rowNum - 1) rows.push([]);
    rows[rowNum - 1] = cells;
  }
  // normalise to a rectangle so callers can index freely
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map(r => { const out = new Array(width).fill(''); for (let i = 0; i < width; i++) if (r[i] !== undefined) out[i] = r[i]; return out; });
}

const unzipWith = (fflate, data, filter) => new Promise((resolve, reject) =>
  fflate.unzip(data, { filter: f => filter(f.name) }, (err, files) => err ? reject(err) : resolve(files)));

/**
 * Read an .xlsx into plain arrays.
 * @param {File|ArrayBuffer} input
 * @param {(name: string, index: number) => boolean} [want]  which sheets to decompress
 * @returns {Promise<{ sheets: {name, rows}[], skipped: string[] }>}
 */
export async function readXlsx(input, want = () => true) {
  const fflate = await import('fflate');
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const data = new Uint8Array(buf);

  const meta = await unzipWith(fflate, data, n =>
    n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml');
  if (!meta['xl/workbook.xml'])
    throw new Error('That file is not a spreadsheet Excel can open. Download the Google Sheet as .xlsx (File → Download → Microsoft Excel).');

  const wbXml = dec.decode(meta['xl/workbook.xml']);
  const relsXml = meta['xl/_rels/workbook.xml.rels'] ? dec.decode(meta['xl/_rels/workbook.xml.rels']) : '';
  const shared = readSharedStrings(meta['xl/sharedStrings.xml'] ? dec.decode(meta['xl/sharedStrings.xml']) : '');

  const rels = {};
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let rm;
  while ((rm = relRe.exec(relsXml))) {
    let target = rm[2].replace(/^\/?xl\//, '').replace(/^\.\//, '');
    rels[rm[1]] = 'xl/' + target;
  }

  const listed = [];
  const sheetRe = /<sheet[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*?\/?>/g;
  let sm;
  while ((sm = sheetRe.exec(wbXml)))
    listed.push({ name: unescapeXml(sm[1]), path: rels[sm[2]] });

  const wanted = listed.filter((s, i) => s.path && want(s.name, i));
  const paths = new Set(wanted.map(s => s.path));
  const files = paths.size ? await unzipWith(fflate, data, n => paths.has(n)) : {};

  return {
    sheets: wanted
      .filter(s => files[s.path])
      .map(s => ({ name: s.name, rows: readSheet(dec.decode(files[s.path]), shared) })),
    skipped: listed.filter(s => !wanted.includes(s)).map(s => s.name),
  };
}

export const listSheetNames = async input => {
  const { sheets, skipped } = await readXlsx(input, () => false);
  return [...sheets.map(s => s.name), ...skipped];
};
