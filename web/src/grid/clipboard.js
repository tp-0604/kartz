// The clipboard, in the dialect every spreadsheet speaks: tab between cells, newline between
// rows, and a quoted cell where either of those appears inside a value.

export function toTsv(matrix) {
  return matrix.map(row => row.map(cellOut).join('\t')).join('\n');
}

const cellOut = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/**
 * A pasted block back into a rectangle. Quoted cells may contain tabs and newlines, which is
 * how a multi-line note survives a trip through Excel, so this cannot be a pair of splits.
 */
export function fromTsv(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!src) return [];
  const rows = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { rows[rows.length - 1].push(cell); cell = ''; }
    else if (c === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]); }
    else cell += c;
  }
  rows[rows.length - 1].push(cell);
  // A block copied out of one cell arrives as one cell; a block copied out of a column arrives
  // ragged where trailing cells were empty. Square it off so the caller can index freely.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map(r => { const out = r.slice(); while (out.length < width) out.push(''); return out; });
}

/** Writing to the clipboard, with the old synchronous route where the async one is refused. */
export async function writeClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* permissions, or an insecure origin */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
