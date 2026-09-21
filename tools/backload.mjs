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
 *   --only <text>    only files whose path contains this
 *   --replace        delete and re-import a file that is already there
 *   --report <path>  write the whole report as JSON
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

const who = DRY ? { name: 'nobody' } : await signIn();
if (!DRY) console.log(`signed in as ${who.name} (${who.role})\n`);

// The folders, made as they are first needed, so an empty directory never appears.
const folderIds = new Map();
async function folderFor(dir) {
  const rel = relative(root, dir);
  const key = rel || '.';
  if (folderIds.has(key)) return folderIds.get(key);
  const parent = rel ? await folderFor(join(dir, '..')) : null;
  const name = rel ? basename(dir) : basename(root);
  const out = DRY ? { folder: { id: 'dry_' + key } } : await api('POST', '/folders', { name, parentId: parent });
  folderIds.set(key, out.folder.id);
  return out.folder.id;
}

let tree = { folders: [], files: [] };
if (!DRY) tree = await api('GET', '/tree');
const existing = new Map(tree.files.map(f => [(f.folder_id || '') + '/' + f.name, f]));

const report = [];
const T = { sheets: 0, cells: 0, bands: 0, bytes: 0, formulas: 0, google: 0, errors: 0,
            images: 0, imageBytes: 0, tables: 0, layouts: 0, skipped: 0, ms: 0 };

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

  if (!DRY) {
    await sendImport(plan, api, {
      putAsset: asset => api('PUT', '/assets/' + asset.id, Buffer.from(asset.bytes),
        { raw: true, headers: { 'content-type': asset.mime } }),
    });
  }

  const ms = Date.now() - t0;
  T.sheets += plan.report.sheets; T.cells += plan.report.cells; T.bands += bands; T.bytes += bytes;
  T.formulas += plan.report.formulas; T.google += plan.report.google; T.errors += plan.report.errors;
  T.images += plan.assets.length; T.imageBytes += imageBytes;
  T.tables += plan.report.tables; T.layouts += plan.report.layouts; T.ms += ms;

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
console.log(`formulas               ${num(T.formulas)} kept · ${num(T.google)} were Sheets-only, `
  + 'value kept and formula noted');
console.log(`already showing errors ${T.errors}`);
if (T.skipped) console.log(`skipped                ${T.skipped} already in the app`);
console.log(`took                   ${(T.ms / 1000).toFixed(1)}s`);

const out = flag('report');
if (out && out !== true) {
  writeFileSync(String(out), JSON.stringify({ root, totals: T, files: report }, null, 2));
  console.log('report written to ' + out);
}
