// Local dev server. Test identities only. Not for public deployment until authentication exists.
// State is saved to server/data.json (git-ignored). Run: npm run server
import http from 'node:http';
import fs from 'node:fs';
import { Api } from '../src/server/api';
import type { AppState } from '../src/core/types';

const FILE = process.env.CREWCODE_DATA ?? new URL('./data.json', import.meta.url).pathname;
let initial: AppState | undefined;
try { initial = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
const api = new Api(initial, (s) => fs.writeFileSync(FILE, JSON.stringify(s)));

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/api') { res.writeHead(404).end(); return; }
  let body = ''; req.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
  req.on('end', () => {
    let out; try { out = api.call(JSON.parse(body)); } catch { out = { ok: false, error: 'Bad request.' }; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
}).listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => console.log('CrewCode dev API on http://127.0.0.1:' + (process.env.PORT ?? 8787) + '/api (test identities only)'));
