// The built app and the real Worker, over a SQLite file, so the whole thing can be driven by a
// browser without Cloudflare in the loop.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeDb, readSchema } from './d1.mjs';
import worker from '../worker.js';

const DIST = new URL('../web/dist/', import.meta.url).pathname;
const DB = makeDb(readSchema());
const raw = DB._raw;

// A board, a roster and a month of history to look at.
const mk = (date, alliance, label) => {
  const id = `kartz|${date}|${alliance}`;
  raw.exec(`INSERT INTO boards (id,event,date,alliance,label,saved_at,version)
            VALUES ('${id}','kartz','${date}','${alliance}','${label}','${date}T09:00:00Z',1)`);
  return id;
};
const NAMES = ['Nubi', 'Goose', 'Amp', 'Weezy', 'Killua', 'Batman', 'Tanjiro', 'Duke', 'Lexi', 'Mav',
               'Panda', 'Darth', 'Hank', 'Mexi', 'Zed', 'Iris', 'Odin', 'Rune', 'Saga', 'Volt'];
const ALL = ['698W', '698S', '698N', '698C'];
NAMES.forEach((n, i) => raw.exec(
  `INSERT INTO roster (id,search,ingame,alliance,extra,sort,updated_at)
   VALUES ('p${i}','${n}','${n}','${ALL[i % 4]}','{"CP":"${(9 + i * 0.3).toFixed(1)}M"}',${i},'2026-09-01T00:00:00Z')`));
raw.exec(`UPDATE roster_meta SET columns='["Player","Name in video","Alliance","CP"]',
          mapping='{"search":"Player","ingame":"Name in video","alliance":"Alliance"}',
          version=1, saved_at='2026-09-01T00:00:00Z' WHERE id=1`);

let sid = 0;
for (const [date, label] of [['2026-08-24', 'Day 1'], ['2026-08-27', 'Day 4'], ['2026-09-01', 'Day 1'], ['2026-09-04', 'Day 4']]) {
  for (const alliance of ['698W', '698S']) {
    const id = mk(date, alliance, label);
    NAMES.forEach((n, i) => {
      const pts = Math.round(900 - i * 37 + (date.endsWith('04') || date.endsWith('27') ? 120 : 0)
                             + (alliance === '698S' ? -60 : 0) + ((i * 7919) % 53));
      raw.exec(`INSERT INTO scores (id,board_id,place,search,ingame,alliance,points,edited,extra,sort)
                VALUES ('s${sid++}','${id}',${i + 1},'${n}','${n}','${ALL[i % 4]}',${pts},0,NULL,${i + 1})`);
    });
  }
}

const env = {
  DB,
  // Passed through from the environment, never stored here: with a key set, this harness runs a
  // real extraction against the real model.
  // The admin code for signing up as an admin on this local copy.
  ADMIN_CODE: process.env.ADMIN_CODE || 'local-admin',
  OWNER_CODE: process.env.OWNER_CODE || 'local-owner',
  GEMINI_KEY: process.env.GEMINI_KEY,
  AI_PROVIDER: process.env.AI_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  AI_GATEWAY: process.env.AI_GATEWAY,
  // A stand-in for R2: the pictures pasted into imported sheets, on disk under .wrangler so a
  // restart keeps them and git never sees them.
  FILES: (() => {
    const dir = path.join(process.cwd(), '.wrangler', 'local-r2');
    fs.mkdirSync(dir, { recursive: true });
    const meta = f => f + '.type';
    return {
      async put(key, body, opts) {
        fs.writeFileSync(path.join(dir, key), Buffer.from(body));
        fs.writeFileSync(meta(path.join(dir, key)),
          (opts && opts.httpMetadata && opts.httpMetadata.contentType) || 'application/octet-stream');
      },
      async get(key) {
        const f = path.join(dir, key);
        if (!f.startsWith(dir) || !fs.existsSync(f)) return null;
        const body = fs.readFileSync(f);
        return { body, size: body.length,
                 httpMetadata: { contentType: fs.existsSync(meta(f)) ? fs.readFileSync(meta(f), 'utf8') : null } };
      },
    };
  })(),
  ASSETS: {
    fetch: req => {
      const p = new URL(req.url).pathname.replace(/^\/kartz/, '') || '/';
      const file = path.join(DIST, p === '/' ? 'index.html' : p);
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
        return new Response(fs.readFileSync(path.join(DIST, 'index.html')),
          { headers: { 'content-type': 'text/html' } });
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
                     '.svg': 'image/svg+xml', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type } });
    },
  },
};

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request('http://localhost:8788' + req.url, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k)),
    body,
  });
  try {
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error('worker threw:', e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e && e.stack || e));
  }
}).listen(8788, () => console.log('ready on http://localhost:8788/'));
