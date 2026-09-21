/**
 * Move a folder of spreadsheets into the app, once.
 *
 *   node tools/backload.mjs --from "/path/to/TW 2698" --api http://localhost:8788/api \
 *                           --name Tess --password secret --code $ADMIN_CODE
 *
 * It walks the folder, mirrors the directory tree as folders, and imports every .xlsx it
 * finds — nothing else. Each workbook is read in full here, planned here, compressed here, and
 * sent to the Worker one band at a time, so the Worker never holds a whole file in memory and
 * never spends its CPU on unzipping one.
 *
 * Running it twice is safe: a file already in its folder is skipped unless --replace is given,
 * and a picture already in the bucket is never uploaded again.
 *
 * Useful flags:
 *   --dry            read and plan everything, send nothing
 *   --sql <dir>      write the whole backload as SQL and a folder of pictures, for
 *                    "wrangler d1 execute --file" and "wrangler r2 object put" — the way to
 *                    load production without holding anybody's password
 *   --only <text>    only files whose path contains this
 *   --replace        delete and re-import a file that is already there
 *   --report <path>  write the whole report as JSON
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import { readBook } from '../web/src/services/xlsxBook.js';
import { planImport, sendImport } from '../web/src/services/bookImport.js';

/* ------------------------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? fallback : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};
const has = name => argv.includes('--' + name);

const FROM = flag('from');
const API = String(flag('api', 'http://localhost:8788/api')).replace(/\/+$/, '');
const DRY = has('dry');
const REPLACE = has('replace');
const ONLY = flag('only');
const SQL = flag('sql');

if (!FROM) {
  console.error('Give it a folder: --from "/path/to/TW 2698"');
  process.exit(2);
}

/* --------------------------------------------------------------------------------- talking */

let session = null;
async function api(method, path, body, extra = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Sec-Fetch-Site': 'same-origin',
      ...(body !== undefined && !extra.raw ? { 'content-type': 'application/json' } : {}),
      ...(session ? { 'x-kartz-session': session } : {}),
      ...(extra.headers || {}),
    },
    body: body === undefined ? undefined : (extra.raw ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    const message = (json && json.error && json.error.message) || text.slice(0, 200);
    throw new Error(`${method} ${path} → ${res.status}: ${message}`);
  }
  return json;
}

async function signIn() {
  const name = String(flag('name', 'Backload'));
  const password = String(flag('password', ''));
  const code = flag('code');
  if (!password) { console.error('Give it a password: --password …'); process.exit(2); }
  try {
    const out = await api('POST', '/auth/signin', { name, password, ...(code ? { adminCode: code } : {}) });
    session = out.token;
    return out.user;
  } catch {
    const out = await api('POST', '/auth/signup',
      { name, password, ...(code ? { admin: true, adminCode: code } : {}) });
    session = out.token;
    return out.user;
  }
}

/* --------------------------------------------------------------------------- writing SQL */

// D1 allows a hundred thousand bytes per statement, and a band of a busy sheet is larger than
// that once it is written as hex. So a big value goes in as its first chunk and is appended to,
// which SQLite does losslessly for blobs as long as the result is cast back.
const CHUNK = 40000;                                   // hex characters, so 20 KB of bytes
const hexOf = bytes => Buffer.from(bytes).toString('hex');
const q = v => (v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
const n = v => (v === null || v === undefined || v === '' ? 'NULL' : String(Math.round(Number(v)) || 0));

const statements = [];
const say = sql => statements.push(sql);

/** A long value, written as a first statement and then appended to. */
function writeLong(table, cols, key, column, hex, asText, updateOnly) {
  const wrap = h => (asText ? `CAST(X'${h}' AS TEXT)` : `X'${h}'`);
  const first = hex.slice(0, CHUNK);
  if (updateOnly) {
    // The row is already there; this fills one of its columns.
    say(`UPDATE ${table.replace(/_[a-z]+$/, '')} SET ${column} = ${wrap(first)} WHERE ${key};`);
    table = table.replace(/_[a-z]+$/, '');
    for (let i = CHUNK; i < hex.length; i += CHUNK) {
      const part = hex.slice(i, i + CHUNK);
      say(`UPDATE ${table} SET ${column} = ${column} || ${wrap(part)} WHERE ${key};`);
    }
    return;
  }
  say(`INSERT INTO ${table} (${cols.names.join(', ')}) VALUES (${cols.values(wrap(first))});`);
  for (let i = CHUNK; i < hex.length; i += CHUNK) {
    const part = hex.slice(i, i + CHUNK);
    const cast = asText ? `${column} || CAST(X'${part}' AS TEXT)` : `CAST(${column} || X'${part}' AS BLOB)`;
    say(`UPDATE ${table} SET ${column} = ${cast} WHERE ${key};`);
  }
}

const newRowId = prefix => prefix + '_' + randomUUID().replace(/-/g, '').slice(0, 20);

function sqlFolder(id, parentId, name, at) {
  say(`INSERT INTO folders (id, parent_id, name, sort, created_at, created_by) `
    + `VALUES (${q(id)}, ${q(parentId)}, ${q(name)}, 0, ${q(at)}, NULL);`);
}

function sqlFile(plan, fileId, folderId, at) {
  say(`INSERT INTO files (id, folder_id, name, source, source_name, sheets, cells, version, ready, `
    + `report, created_at, updated_at, created_by) VALUES (${q(fileId)}, ${q(folderId)}, `
    + `${q(plan.file.name)}, 'xlsx', ${q(plan.file.sourceName)}, 0, 0, 1, 0, NULL, ${q(at)}, ${q(at)}, NULL);`);

  // The report is written at the end, once the tabs have been counted.
  const report = hexOf(Buffer.from(JSON.stringify(plan.report)));

  plan.styles.forEach((style, idx) => {
    say(`INSERT INTO styles (file_id, idx, json) VALUES (${q(fileId)}, ${idx}, `
      + `CAST(X'${hexOf(Buffer.from(JSON.stringify(style || {})))}' AS TEXT));`);
  });
  return report;
}

const faceScore = cover => {
  if (!cover || !Array.isArray(cover.palette)) return 0;
  const colours = cover.palette.filter(p => typeof p === 'string' && p.charAt(0) === '#').length;
  return Math.round(colours * 20 + (Number(cover.ink) || 0) * 6);
};

function sqlSheet(sheet, sheetId, fileId) {
  const cover = sheet.cover ? hexOf(Buffer.from(JSON.stringify(sheet.cover))) : null;
  say(`INSERT INTO sheets (id, file_id, name, idx, shape, rows, cols, cells, hidden, frozen, `
    + `tab_color, defaults, face, version) VALUES (${q(sheetId)}, ${q(fileId)}, ${q(sheet.name)}, `
    + `${n(sheet.idx)}, ${q(sheet.shape)}, ${n(sheet.rows)}, ${n(sheet.cols)}, `
    + `${sheet.bands.reduce((t, b) => t + b.count, 0)}, ${sheet.hidden ? 1 : 0}, `
    + `${sheet.frozen ? q(JSON.stringify(sheet.frozen)) : 'NULL'}, ${q(sheet.tabColor)}, `
    + `${sheet.defaults && Object.keys(sheet.defaults).length ? q(JSON.stringify(sheet.defaults)) : 'NULL'}, `
    + `${faceScore(sheet.cover)}, 1);`);
  if (cover) {
    writeLong('sheets_cover', null, `id = ${q(sheetId)}`, 'cover', cover, true, sheetId);
  }

  for (const band of sheet.bands) {
    const bytes = Buffer.from(band.cells, 'base64');
    const hex = hexOf(bytes);
    writeLong('slabs', {
      names: ['sheet_id', 'band', 'cells', 'count', 'bytes'],
      values: first => `${q(sheetId)}, ${band.band}, ${first}, ${band.count}, ${bytes.length}`,
    }, `sheet_id = ${q(sheetId)} AND band = ${band.band}`, 'cells', hex, false);
  }

  for (const [kind, json] of Object.entries(sheet.meta)) {
    const hex = hexOf(Buffer.from(JSON.stringify(json)));
    writeLong('sheet_meta', {
      names: ['sheet_id', 'kind', 'json'],
      values: first => `${q(sheetId)}, ${q(kind)}, ${first}`,
    }, `sheet_id = ${q(sheetId)} AND kind = ${q(kind)}`, 'json', hex, true);
  }

  // The projection: the part of the sheet that is really a table.
  if (sheet.table && sheet.table.rows.length) {
    const tableId = newRowId('tb');
    const columns = hexOf(Buffer.from(JSON.stringify(sheet.table.columns)));
    say(`INSERT INTO tables (id, sheet_id, name, header_row, first_row, last_row, first_col, `
      + `last_col, rows, columns) VALUES (${q(tableId)}, ${q(sheetId)}, ${q(sheet.table.name)}, `
      + `${n(sheet.table.headerRow)}, ${n(sheet.table.firstRow)}, ${n(sheet.table.lastRow)}, `
      + `${n(sheet.table.firstCol)}, ${n(sheet.table.lastCol)}, ${sheet.table.rows.length}, `
      + `CAST(X'${columns}' AS TEXT));`);
    // Twenty rows to a statement keeps every one of them well inside D1's limit.
    for (let i = 0; i < sheet.table.rows.length; i += 8) {
      const group = sheet.table.rows.slice(i, i + 8);
      const values = group.map(row =>
        `(${q(newRowId('tr'))}, ${q(tableId)}, ${n(row.idx)}, ${n(row.r)}, `
        + `CAST(X'${hexOf(Buffer.from(JSON.stringify(row.data)))}' AS TEXT))`).join(',');
      say(`INSERT INTO table_rows (id, table_id, idx, r, data) VALUES ${values};`);
    }
  }
}

/* ----------------------------------------------------------------------------- the walking */

const isBook = f => /\.xlsx$/i.test(f) && !basename(f).startsWith('~$');

function walk(dir, into = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, into);
    else if (isBook(p)) into.push(p);
  }
  return into;
}

const mb = n => (n / 1048576).toFixed(1) + ' MB';
const num = n => Number(n).toLocaleString('en');

/* ------------------------------------------------------------------------------- the work */

const root = String(FROM).replace(/\/+$/, '');
let files = walk(root);
if (ONLY && ONLY !== true) files = files.filter(f => f.toLowerCase().includes(String(ONLY).toLowerCase()));
if (!files.length) { console.error('No .xlsx under ' + root); process.exit(1); }

const skippedKinds = new Map();
(function countSkipped(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) countSkipped(p);
    else if (!isBook(p)) {
      const ext = (e.name.split('.').pop() || '?').toLowerCase();
      skippedKinds.set(ext, (skippedKinds.get(ext) || 0) + 1);
    }
  }
})(root);

console.log(`\n${files.length} workbooks under ${basename(root)}`);
if (skippedKinds.size) {
  console.log('leaving out ' + [...skippedKinds.entries()].sort((a, b) => b[1] - a[1])
    .map(([ext, n]) => `${n} .${ext}`).join(', '));
}
if (DRY) console.log('dry run: reading and planning only, nothing is sent\n');

const who = (DRY || SQL) ? { name: 'nobody' } : await signIn();
if (!DRY && !SQL) console.log(`signed in as ${who.name} (${who.role})\n`);
if (SQL) {
  mkdirSync(String(SQL), { recursive: true });
  mkdirSync(join(String(SQL), 'assets'), { recursive: true });
  console.log('writing SQL to ' + SQL + ', nothing is sent\n');
}

// The folders, made as they are first needed, so an empty directory never appears.
const folderIds = new Map();
async function folderFor(dir) {
  const rel = relative(root, dir);
  const key = rel || '.';
  if (folderIds.has(key)) return folderIds.get(key);
  const parent = rel ? await folderFor(join(dir, '..')) : null;
  const name = rel ? basename(dir) : basename(root);
  let out;
  if (SQL) {
    const id = newRowId('fd');
    sqlFolder(id, parent, name, new Date().toISOString());
    out = { folder: { id } };
  } else if (DRY) out = { folder: { id: 'dry_' + key } };
  else out = await api('POST', '/folders', { name, parentId: parent });
  folderIds.set(key, out.folder.id);
  return out.folder.id;
}

let tree = { folders: [], files: [] };
if (!DRY && !SQL) tree = await api('GET', '/tree');
const existing = new Map(tree.files.map(f => [(f.folder_id || '') + '/' + f.name, f]));

const report = [];
const T = { sheets: 0, cells: 0, bands: 0, bytes: 0, formulas: 0, google: 0, errors: 0,
            images: 0, imageBytes: 0, tables: 0, layouts: 0, rows: 0, skipped: 0, ms: 0 };

for (const path of files) {
  const rel = relative(root, path);
  const name = basename(path).replace(/\.xlsx$/i, '');
  const size = statSync(path).size;
  const t0 = Date.now();
  process.stdout.write(`  ${rel.padEnd(52).slice(0, 52)} ${mb(size).padStart(9)} `);

  const folderId = await folderFor(join(path, '..'));
  const already = existing.get((folderId || '') + '/' + name);
  if (already && !REPLACE) {
    console.log('· already there, skipped');
    T.skipped++;
    continue;
  }
  if (already && REPLACE) await api('DELETE', '/files/' + already.id);

  const book = await readBook(readFileSync(path), { media: true });
  const plan = await planImport(book, { name, sourceName: basename(path), folderId });

  const bands = plan.sheets.reduce((n, s) => n + s.bands.length, 0);
  const bytes = plan.sheets.reduce((n, s) => n + s.bands.reduce((b, x) => b + x.bytes, 0), 0);
  const imageBytes = plan.assets.reduce((n, a) => n + a.bytes.length, 0);

  if (SQL) {
    const at = new Date().toISOString();
    const fileId = newRowId('fl');
    const report = sqlFile(plan, fileId, folderId, at);
    for (const sheet of plan.sheets) sqlSheet(sheet, newRowId('sh'), fileId);
    say(`UPDATE files SET ready = 1, sheets = (SELECT COUNT(*) FROM sheets WHERE file_id = ${q(fileId)}), `
      + `cells = (SELECT COALESCE(SUM(cells), 0) FROM sheets WHERE file_id = ${q(fileId)}), `
      + `report = CAST(X'${report}' AS TEXT) WHERE id = ${q(fileId)};`);
    for (const asset of plan.assets) {
      const ext = (asset.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
      writeFileSync(join(String(SQL), 'assets', asset.id + '.' + ext), Buffer.from(asset.bytes));
      say(`INSERT OR IGNORE INTO assets (id, mime, bytes, created_at, created_by) `
        + `VALUES (${q(asset.id)}, ${q(asset.mime)}, ${asset.bytes.length}, ${q(at)}, NULL);`);
    }
  } else if (!DRY) {
    await sendImport(plan, api, {
      putAsset: asset => api('PUT', '/assets/' + asset.id, Buffer.from(asset.bytes),
        { raw: true, headers: { 'content-type': asset.mime } }),
    });
  }

  const ms = Date.now() - t0;
  T.sheets += plan.report.sheets; T.cells += plan.report.cells; T.bands += bands; T.bytes += bytes;
  T.formulas += plan.report.formulas; T.google += plan.report.google; T.errors += plan.report.errors;
  T.images += plan.assets.length; T.imageBytes += imageBytes;
  T.tables += plan.report.tables; T.layouts += plan.report.layouts;
  T.rows += plan.report.rows || 0; T.ms += ms;

  console.log(`${String(plan.report.sheets).padStart(3)} tabs  ${num(plan.report.cells).padStart(9)} cells  `
    + `${(bytes / 1024).toFixed(0).padStart(6)} KB  `
    + `${plan.assets.length ? String(plan.assets.length).padStart(3) + ' img' : '      '}  ${ms} ms`);

  report.push({ file: rel, name, size, ms, bands, bytes, imageBytes,
                assets: plan.assets.length, ...plan.report });
}

console.log('\n' + '─'.repeat(78));
console.log(`${files.length - T.skipped} workbooks · ${T.sheets} tabs · ${num(T.cells)} cells`);
console.log(`grid in the database   ${mb(T.bytes)} in ${T.bands} bands`);
console.log(`pictures in the bucket ${mb(T.imageBytes)} in ${T.images} objects`);
console.log(`tabs judged            ${T.tables} table or mixed · ${T.layouts} layout`);
console.log(`rows projected         ${num(T.rows)} — what the analyst and the filters read`);
console.log(`formulas               ${num(T.formulas)} kept · ${num(T.google)} were Sheets-only, `
  + 'value kept and formula noted');
console.log(`already showing errors ${T.errors}`);
if (T.skipped) console.log(`skipped                ${T.skipped} already in the app`);
console.log(`took                   ${(T.ms / 1000).toFixed(1)}s`);

if (SQL) {
  const file = join(String(SQL), 'backload.sql');
  writeFileSync(file, statements.join('\n') + '\n');
  const longest = statements.reduce((m, x) => Math.max(m, x.length), 0);
  console.log(`\n${statements.length.toLocaleString('en')} statements in ${file}`);
  console.log(`longest statement ${longest.toLocaleString('en')} bytes (D1 allows 100,000)`);
  console.log(`pictures written to ${join(String(SQL), 'assets')}`);
}

const out = flag('report');
if (out && out !== true) {
  writeFileSync(String(out), JSON.stringify({ root, totals: T, files: report }, null, 2));
  console.log('report written to ' + out);
}
