// Reading the roster tab. Lifted verbatim from the single-file page: Google serves any
// link-readable sheet as CSV from /export with permissive CORS, so the browser reads the
// live roster itself and nothing can go stale.
export function sheetCsvUrl(link) {
  const id = (link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1];
  if (!id) throw new Error('That does not look like a Google Sheets link.');
  const gid = (link.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}
// Minimal RFC4180 reader — roster names legitimately contain commas and newlines.
export function parseCsv(text) {
  const rows = [[]]; let cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { rows[rows.length-1].push(cell); cell = ''; }
    else if (c === '\n') { rows[rows.length-1].push(cell); cell = ''; rows.push([]); }
    else if (c !== '\r') cell += c;
  }
  rows[rows.length-1].push(cell);
  return rows.filter(r => r.some(x => x.trim()));
}
export async function pullRoster(link) {
  const r = await fetch(sheetCsvUrl(link));
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403
    ? 'The sheet is not readable by link. In Google Sheets: Share → General access → Anyone with the link → Viewer.'
    : 'Could not read the sheet (' + r.status + ').');
  const text = await r.text();
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Google returned a sign-in page — the sheet is not link-readable.');
  const rows = parseCsv(text);
  // Every column the tab has, not the three this app happens to match on. The roster is a
  // document people maintain — CP, march types, notes — and showing three of its columns made
  // the app a worse view of it than the sheet it came from.
  const looksHeader = c =>
    /^(search(able)?|player|in ?game)\s*name/i.test(((c && c[0]) || '').trim());
  const header = rows.length && looksHeader(rows[0]) ? rows[0] : [];
  const body = (header.length ? rows.slice(1) : rows)
    .filter(c => (c[0] || '').trim() && !looksHeader(c));
  // A column earns its place by having a heading or any value under it: the export carries
  // trailing empties and a stray note cell, and neither is a column anybody wants offered.
  // A to I. Everything past that on this tab is the tab talking to itself: column J repeats
  // the search name, and the last cell is the note telling people not to edit it by hand.
  // Neither is a column anybody wants offered, and both are artefacts rather than data.
  const ROSTER_LAST_COL = 9;
  const width = Math.min(ROSTER_LAST_COL,
                         Math.max(header.length, ...body.map(c => c.length), 0));
  const keep = [];
  for (let i = 0; i < width; i++)
    if ((header[i] || '').trim() || body.some(c => (c[i] || '').trim())) keep.push(i);
  const used = new Map();
  const cols = keep.map(i => {
    let label = (header[i] || '').replace(/\s+/g, ' ').trim() || `Column ${i + 1}`;
    // Two columns really are both called Search Name in this tab, and a picker with two
    // identical entries is a picker you cannot use.
    const n = (used.get(label) || 0) + 1;
    used.set(label, n);
    return { label: n > 1 ? `${label} (${n})` : label, i };
  });
  const all = body.map(c => ({
    search: (c[0] || '').trim(),
    ingame: (c[1] || c[0] || '').trim(),
    alliance: (c[2] || '').trim(),
    cells: keep.map(i => (c[i] || '').trim()),
  }));
  if (!all.length) throw new Error('No roster rows found in that tab.');
  // Every row is kept, and the filter is applied when the roster is read rather than baked in
  // here. Splitting at pull time meant changing the filter did nothing until you pulled again,
  // and the count on the badge stayed where it was.
  return { all, cols };
}
// Nothing is filtered out any more. Every player in the sheet is a candidate, including the
// ones parked in z3.? or z1.Transferred: they are on the roster, and a row in the recording
// that matches one of them is better recognised than left as a stranger. The alliance column
// is still read, because the results table shows it.
