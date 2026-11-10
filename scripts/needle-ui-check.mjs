// Real-inference UI check: Suggest button -> local Needle proposes -> suggestion card -> Run executes via gated path.
import fs from 'fs'; import { spawn } from 'child_process';
const { default: puppeteer } = await import(process.env.CREWCODE_BROWSER_DRIVER || 'puppeteer-core');
const OUT = process.argv[2] || 'shots/needle';
fs.mkdirSync(OUT, { recursive: true });
const cwd = process.cwd();
const srv = spawn('node', ['dist-server/index.js'], { cwd, env: { ...process.env, PORT: '8787', NEEDLE_ENABLED: '1', CREWCODE_DATA: '/tmp/crewcode-needle-' + Date.now() + '.json' }, stdio: 'ignore' });
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5176', '--strictPort'], { cwd, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitText = async (p, t) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 40000 }, t);
async function click(p, t) { await p.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === t && !b.disabled), { timeout: 40000 }, t); const hs = await p.$$('button'); for (const h of hs) { if (await h.evaluate((b, t) => b.textContent.trim() === t, t)) { await h.click(); return; } } throw Error('missing ' + t); }
let browser;
try {
  for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:5176'); break; } catch { await sleep(250); } }
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:8787/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'u-ram', op: 'listUsers' }) }); if (r.ok) break; } catch {} await sleep(250); }
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 1000 });
  await page.goto('http://127.0.0.1:5176');
  await click(page, 'Ram'); await waitText(page, 'Habit Tracker');
  for (const h of await page.$$('button.card')) { if (await h.evaluate((e) => e.textContent.includes('Habit Tracker'))) { await h.click(); break; } }
  await waitText(page, 'Chat');
  await click(page, 'Assign tasks (simulated)');
  await click(page, 'Approve plan');
  await sleep(2000);
  // Pull the REAL task id from the API - never assume a shape.
  let taskId = '';
  for (let i = 0; i < 20 && !taskId; i++) {
    const r = await fetch('http://127.0.0.1:8787/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'u-ram', op: 'listProjects' }) });
    const d = await r.json();
    const proj = (d.data || []).find((x) => x.name === 'Habit Tracker');
    if (proj && proj.tasks && proj.tasks.length) taskId = proj.tasks[0].id;
    else await sleep(500);
  }
  if (!taskId) throw Error('no task after approved plan');
  console.log('REAL-TASK:', taskId);
  await page.type('textarea[aria-label="Message"]', 'build task ' + taskId);
  // The small local model is nondeterministic: retry Suggest until a card or a note appears.
  let note = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    await click(page, 'Suggest');
    await page.waitForFunction(() => document.body.innerText.includes('Suggested action') || !!document.querySelector('.composer .muted'), { timeout: 90000 });
    note = await page.evaluate(() => document.body.innerText);
    if (note.includes('Suggested action')) break;
    const mm = note.match(/[^\n]*(unavailable|No confident|Rejected|reject|confident)[^\n]*/i);
    console.log('attempt', attempt + 1, 'no card:', mm ? mm[0] : 'unknown note');
  }
  await page.screenshot({ path: OUT + '/50a-suggest-card.png' });
  const hasCard = note.includes('Suggested action');
  if (!hasCard && !note.includes('Suggested action')) { /* fallthrough to explicit failure below */ }
  console.log('SUGGEST-RESULT:', hasCard ? 'CARD SHOWN' : 'NOTE: ' + (note.match(/No confident[^\n]*|unavailable[^\n]*|rejected[^\n]*/)?.[0] || 'unknown'));
  if (hasCard) {
    const m = note.match(/Suggested action \(local model\):([\s\S]{0,200})/);
    console.log('CARD-TEXT:', (m ? m[1] : '').replace(/\n/g, ' | ').slice(0, 160));
    // Run it: must go through the normal gated path (owner Ram can runBuild on his project).
    await click(page, 'Run');
    await page.waitForFunction(() => document.body.innerText.includes('Simulated build.') || document.body.innerText.includes('Task not found') || document.body.innerText.includes('not yours'), { timeout: 30000 });
    const after = await page.evaluate(() => document.body.innerText);
    const built = after.includes('Simulated build.');
    console.log('AFTER-RUN build success:', built, '| task-not-found:', after.includes('Task not found'));
    if (!built) throw Error('run did not produce a real build message');
    await page.screenshot({ path: OUT + '/50b-after-run.png' });
  }
  if (!note.includes('Suggested action')) throw Error('no suggestion card produced');
  console.log('PASS needle UI check');
} finally { if (browser) await browser.close(); srv.kill(); vite.kill(); }
