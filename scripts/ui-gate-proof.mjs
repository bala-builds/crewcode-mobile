// Visual proof of the owner plan gate: proposal card + dependency-blocked merge in the real UI.
import fs from 'fs';
import { spawn } from 'child_process';
const { default: puppeteer } = await import(process.env.CREWCODE_BROWSER_DRIVER || 'puppeteer-core');
const OUT = process.argv[2] || 'shots/gate';
fs.mkdirSync(OUT, { recursive: true });
const cwd = process.cwd();
const data = '/tmp/crewcode-gate-' + Date.now() + '.json';
const srv = spawn('node', ['dist-server/index.js'], { cwd, env: { ...process.env, PORT: '8787', CREWCODE_DATA: data }, stdio: 'ignore' });
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitText = async (p, t) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, t);
async function click(p, t) { await p.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === t && !b.disabled), { timeout: 30000 }, t); const hs = await p.$$('button'); for (const h of hs) { if (await h.evaluate((b, t) => b.textContent.trim() === t, t)) { await h.click(); return; } } throw Error('missing ' + t); }
const shot = async (p, n) => { await p.screenshot({ path: OUT + '/' + n }); console.log('SHOT', n); };
let browser;
try {
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:5175'); break; } catch { await sleep(200); } }
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const mk = async () => { const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1280, height: 1000 }); await p.goto('http://127.0.0.1:5175'); return p; };
  const owner = await mk(); await click(owner, 'Ram'); await click(owner, 'Create project'); await owner.type('#pn', 'Gate Proof App');
  await owner.type('#prd', 'A shared habit app.\n\nFeatures:\n- Home: the shared habit list\n- Settings: user preferences (depends on home)');
  await click(owner, 'Create'); await waitText(owner, 'Project created'); const code = await owner.$eval('.code', (e) => e.textContent.trim());
  await click(owner, 'Choose AI model'); await click(owner, 'Continue'); await waitText(owner, 'Ready to divide the work?');
  const mate = await mk(); await click(mate, 'Seeta'); await click(mate, 'Join project'); await mate.type('#tc', code); await click(mate, 'frontend'); await click(mate, 'Join'); await click(mate, 'Continue');
  await click(owner, 'Back'); await owner.reload(); await waitText(owner, 'Gate Proof App');
  for (const h of await owner.$$('button.card')) { if (await h.evaluate((e) => e.textContent.includes('Gate Proof App'))) { await h.click(); break; } }
  await click(owner, 'Assign tasks (simulated)'); await waitText(owner, 'Review the proposed split');
  await shot(owner, '40a-proposal-card.png');
  await click(owner, 'Approve plan'); await waitText(owner, 'Seeta');
  const mate2 = await mk(); await click(mate2, 'Seeta'); await waitText(mate2, 'Gate Proof App');
  for (const h of await mate2.$$('button.card')) { if (await h.evaluate((e) => e.textContent.includes('Gate Proof App'))) { await h.click(); break; } }
  // Teammate builds BOTH features (two simulated builds), marks both done, submits both.
  await click(mate2, 'Run simulated build'); await waitText(mate2, 'simulated build');
  await mate2.reload(); await waitText(mate2, 'Gate Proof App');
  for (const h of await mate2.$$('button.card')) { if (await h.evaluate((e) => e.textContent.includes('Gate Proof App'))) { await h.click(); break; } }
  await click(mate2, 'Run simulated build').catch(() => {}); await sleep(1500);
  await click(mate2, 'Tasks');
  for (let i = 0; i < 2; i++) { await click(mate2, 'done').catch(() => {}); await sleep(700); await click(mate2, 'Submit for merge').catch(() => {}); await sleep(1200); }
  await owner.reload(); await waitText(owner, 'Gate Proof App');
  for (const h of await owner.$$('button.card')) { if (await h.evaluate((e) => e.textContent.includes('Gate Proof App'))) { await h.click(); break; } }
  await click(owner, 'Tasks');
  await owner.waitForFunction(() => (document.body.innerText.match(/submitted/g) || []).length >= 2, { timeout: 20000 });
  // Try to merge the DEPENDENT feature (settings) before its dependency (home): must be refused.
  const mergeOn = async (label) => owner.evaluate((lbl) => {
    const cards = [...document.querySelectorAll('.card')];
    const c = cards.find((x) => x.textContent.includes(lbl));
    if (!c) return 'no card';
    const b = [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Merge into main');
    if (!b) return 'no merge button';
    b.click(); return 'clicked';
  }, label);
  // run its check first so only the dependency gate can block the merge
  const checkOn = async (label) => owner.evaluate((lbl) => {
    const cards = [...document.querySelectorAll('.card')];
    const c = cards.find((x) => x.textContent.includes(lbl));
    const b = c && [...c.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Run check');
    if (b) { b.click(); return 'clicked'; } return 'no check button';
  }, label);
  console.log('CHECK', await checkOn('Build Settings')); await sleep(1500);
  console.log('MERGE', await mergeOn('Build Settings')); await sleep(1000);
  const blocked = await owner.evaluate(() => document.body.innerText);
  await shot(owner, '40b-merge-blocked.png');
  if (!/Depends on/.test(blocked)) throw Error('dependency block not shown');
  console.log('DEP-BLOCK-VISIBLE');
  console.log('PASS gate proof');
} finally { if (browser) await browser.close(); srv.kill(); vite.kill(); }
