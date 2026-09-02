// Reading a Google Sheets tab as CSV. The roster no longer comes from one — it is kept in this
// app's own database — but backloading old boards still reads a tab by link, and both of these
// are used for that.
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
