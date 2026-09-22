/**
 * The built dialog, shown the way Google will show it.
 *
 * Apps Script is not on this machine, so the bridge falls back to its stand-in spreadsheet and
 * the whole dialog can be looked at and clicked through here. The page around it is a mock of
 * Sheets — a grid behind, and the title bar Google puts on a modeless dialog — drawn at the
 * real pixel sizes the script asks for, so the layout is judged at the size it will be.
 *
 * The buttons switch the dialog between its four steps, and the review one also grows the
 * frame the way google.script.host.setWidth does inside Sheets.
 *
 *   node tools/serve-dialog.mjs      → http://localhost:8788
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'addon', 'Dialog.html');
const PORT = 8788;

const SHEET_ROWS = [
  ['1', 'Place', 'Searchable Name', 'Game Name', 'Alliance', 'Points', 'Date'],
  ['2', '1', 'Nubi', 'ŊŲƁĮ', '698W', '612', '2026-09-15'],
  ['3', '2', 'Goose', 'GOOSE', '698W', '588', '2026-09-15'],
  ['4', '3', 'Glitter', 'Glitter', '698W', '540', '2026-09-15'],
  ['5', '4', 'BigMark', 'BigMark', '698W', '505', '2026-09-15'],
  ['6', '5', 'Neaira', 'Neaira', '698W', '498', '2026-09-15'],
  ['7', '6', 'Cutsnake', 'Cutsnake', '698W', '455', '2026-09-15'],
  ['8', '7', 'Eskimo', 'Eskimo❄️', '698N', '430', '2026-09-15'],
  ['9', '8', 'A west', 'A', '698W', '402', '2026-09-15'],
  ['10', '9', 'Amcia', 'Amcia', '698C', '377', '2026-09-15'],
  ['11', '10', 'Cein', 'Cein🌟', '698N', '340', '2026-09-15'],
  ['12', '11', 'Aaron028', 'Aaron028', '698W', '318', '2026-09-15'],
  ['13', '', '', '', '', '', ''],
];

const cell = (v, i) => `<td class="${i === 0 ? 'rn' : ''}">${v}</td>`;
const grid = SHEET_ROWS.map(r => `<tr>${r.map(cell).join('')}</tr>`).join('');

const FRAME = `<!doctype html><meta charset="utf-8"><title>Kartz — modeless dialog</title>
<style>
  :root { --chrome: #fff; --edge: #e1e3e1; --text: #1f1f1f; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; background: #f8f9fa; color: var(--text);
               font: 13px/1.4 Inter, Roboto, system-ui, sans-serif; }
  .app { height: 100%; display: grid; grid-template-rows: auto auto 1fr; }
  .bar { background: #fff; border-bottom: 1px solid var(--edge); padding: 8px 14px;
         display: flex; align-items: center; gap: 14px; }
  .bar .doc { font-size: 16px; }
  .bar .menu { display: flex; gap: 14px; color: #444; font-size: 12.5px; }
  .bar .menu b { color: #0b57d0; font-weight: 600; }
  .tools { background: #fff; border-bottom: 1px solid var(--edge); padding: 6px 14px;
           color: #9aa0a6; font-size: 12px; letter-spacing: .18em; }
  .sheetwrap { overflow: auto; position: relative; }
  table { border-collapse: collapse; font-size: 12.5px; }
  td { border: 1px solid #e6e8ea; padding: 4px 10px; min-width: 116px; height: 24px;
       background: #fff; white-space: nowrap; }
  td.rn { min-width: 34px; text-align: center; color: #80868b; background: #f8f9fa; }
  tr:first-child td { font-weight: 600; background: #f1f3f4; }

  /* Google's own dialog chrome: a white card, a title bar, a close cross, a shadow. */
  .dialog { position: fixed; top: 76px; left: 50%; transform: translateX(-50%);
            background: #fff; border-radius: 8px; overflow: hidden;
            box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 8px 28px 4px rgba(60,64,67,.25);
            transition: width .25s ease, height .25s ease; }
  .dialog__bar { height: 44px; display: flex; align-items: center; padding: 0 14px;
                 border-bottom: 1px solid var(--edge); font-size: 15px; }
  .dialog__bar span { flex: 1; }
  .dialog__bar button { border: 0; background: none; font-size: 17px; color: #5f6368;
                        cursor: pointer; line-height: 1; }
  iframe { display: block; border: 0; width: 100%; }

  .steps { position: fixed; left: 14px; bottom: 14px; display: flex; gap: 6px;
           background: #fff; border: 1px solid var(--edge); border-radius: 999px; padding: 6px; }
  .steps button { border: 0; border-radius: 999px; padding: 6px 12px; font: inherit;
                  font-size: 12px; cursor: pointer; background: #f1f3f4; color: #3c4043; }
  .steps button.on { background: #0b57d0; color: #fff; }
  .size { position: fixed; right: 14px; bottom: 16px; color: #80868b; font-size: 12px; }
</style>
<div class="app">
  <div class="bar">
    <span class="doc">TW 2698 — Kartz Tracking</span>
    <span class="menu">File Edit View Insert Format Data Tools Extensions Help <b>Kartz</b></span>
  </div>
  <div class="tools">▣ ↶ ↷ 🖨 100% $ % .0 .00 123 ▾ | B I S A ▾ ⊞ ≡ ▾</div>
  <div class="sheetwrap"><table>${grid}</table></div>
</div>

<div class="dialog" id="dlg">
  <div class="dialog__bar"><span>Kartz</span><button title="Google's close button">✕</button></div>
  <iframe id="f" src="/dialog" title="Kartz"></iframe>
</div>

<div class="steps" id="steps"></div>
<div class="size" id="size"></div>

<script>
  const STEPS = [
    ['start', '', 760, 548],
    ['reading', '?demo=reading', 760, 548],
    ['review', '?demo=review', 900, 648],
    ['done', '?demo=done', 760, 548],
    ['ask', '?demo=ask', 760, 548],
    ['settings', '?demo=settings', 760, 548],
  ];
  const dlg = document.getElementById('dlg');
  const f = document.getElementById('f');
  const size = document.getElementById('size');
  const bar = document.getElementById('steps');
  function go(i) {
    const [name, q, w, h] = STEPS[i];
    dlg.style.width = w + 'px';
    f.style.height = h + 'px';
    f.src = '/dialog' + q;
    size.textContent = w + ' x ' + h + ' — what the page asks Google for at the "' + name + '" step';
    [...bar.children].forEach((b, j) => b.className = j === i ? 'on' : '');
  }
  STEPS.forEach(([name], i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => go(i);
    bar.appendChild(b);
  });
  go(0);
</script>`;

http.createServer((req, res) => {
  if (!fs.existsSync(FILE)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Build it first: cd web && npm run build');
    return;
  }
  const html = req.url.startsWith('/dialog') ? fs.readFileSync(FILE, 'utf8') : FRAME;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(PORT, () => console.log('dialog on http://localhost:' + PORT));
