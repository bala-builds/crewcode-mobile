// Visual proof of the dependency merge refusal in the real owner UI.
// State is prepared through the same API the UI uses; only the final owner steps are driven in Chrome.
import fs from 'fs';
import { spawn } from 'child_process';
const { default: puppeteer } = await import(process.env.CREWCODE_BROWSER_DRIVER || 'puppeteer-core');
const OUT = process.argv[2] || 'shots/gate';
fs.mkdirSync(OUT, { recursive: true });
const cwd = process.cwd();
const data = '/tmp/crewcode-gate2-' + Date.now() + '.json';
const srv = spawn('node', ['dist-server/index.js'], { cwd, env: { ...process.env, PORT: '8787', CREWCODE_DATA: data }, stdio: 'ignore' });
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (as, op, args = {}) => { const r = await fetch('http://127.0.0.1:8787/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as, op, args }) }); const j = await r.json(); if (!j.ok) throw Error(op + ': ' + j.error); return j.data; };
let browser;
try {
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:5175'); break; } catch { await sleep(200); } }
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:8787/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'u-ram', op: 'listUsers' }) }); break; } catch { await sleep(200); } }
  // Seed demo project via API: Ram's Habit Tracker has features Home + Settings (Settings depends on Home).
  const made = await api('u-ram', 'createProject', { name: 'Gate Proof App', prd: 'A shared habit app.\n\nFeatures:\n- Home: the shared habit list\n- Settings: user preferences (depends on home)', instructions: 'Keep code simple.' });
  const pid = made.projectId;
  const pg = await api('u-ram', 'getProject', { projectId: pid });
  await api('u-seeta', 'joinProject', { code: pg.teamCode, interests: ['frontend'] });
  await api('u-ram', 'assignTasks', { projectId: pid });
  await api('u-ram', 'confirmPlanning', { projectId: pid, accept: true });
  let g = await api('u-ram', 'getProject', { projectId: pid });
  // Build the DEPENDENT task only (settings), submit it; leave its dependency (home) unmerged.
  const dep = g.tasks.find((t) => (t.deps || []).length > 0) || g.tasks[g.tasks.length - 1];
  await api(dep.assigneeId, 'runBuild', { projectId: pid, taskId: dep.id });
  await api(dep.assigneeId, 'setTaskStatus', { projectId: pid, taskId: dep.id, status: 'done' });
  await api(dep.assigneeId, 'submitTaskForReview', { projectId: pid, taskId: dep.id });
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 });
  await page.goto('http://127.0.0.1:5175');
  const click = async (p, t) => { await p.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === t && !b.disabled), { timeout: 12000 }, t); const hs = await p.$$('button'); for (const h of hs) { if (await h.evaluate((b, t) => b.textContent.trim() === t, t)) { await h.click(); return; } } throw Error('missing ' + t); };
  const waitText = async (p, t) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 12000 }, t);
  await click(page, 'Ram'); console.log('IN as Ram');
  await waitText(page, 'Gate Proof App');
  for (const h of await page.$$('button.card')) { if (await h.evaluate((e) => e.textContent.includes('Gate Proof App'))) { await h.click(); break; } }
  await waitText(page, 'Chat');
  await click(page, 'Tasks'); console.log('Tasks open');
  await page.waitForFunction(() => document.body.innerText.includes('submitted'), { timeout: 15000 });
  // Run the check on the dependent task, then try to merge it: the dependency gate must refuse.
  await click(page, 'Run check'); await waitText(page, 'ready');
  await click(page, 'Merge into main'); await sleep(1200);
  const body = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: OUT + '/40b-merge-blocked.png' });
  if (!/Depends on/.test(body)) throw Error('dependency block not shown: ' + body.slice(0, 300));
  console.log('DEP-BLOCK-VISIBLE:', /Depends on[^\n]*/.exec(body)?.[0], '| merged-present:', /Merged into main/.test(body), '| refusal-present:', /merge that feature first/.test(body)); console.log('CHECK-MERGE-DONE');
  console.log('PASS gate proof');
} finally { if (browser) await browser.close(); srv.kill(); vite.kill(); }
