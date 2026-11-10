import { spawn } from 'child_process';
import fs from 'fs';
const { default: puppeteer } = await import('puppeteer-core');
const OUT = 'shots/design'; fs.mkdirSync(OUT, { recursive: true });
const srv = spawn('node', ['dist-server/index.js'], { env: { ...process.env, PORT: '8787', CREWCODE_DATA: '/tmp/crewcode-design-' + Date.now() + '.json' }, stdio: 'ignore' });
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5177', '--strictPort'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:5177'); break; } catch { await sleep(250); } }
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:8787/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ as: 'u-ram', op: 'listUsers' }) }); if (r.ok) break; } catch {} await sleep(250); }
  browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:5177/#demo=ram');
  await page.waitForFunction(() => document.body.innerText.includes('Habit Tracker'), { timeout: 30000 });
  await sleep(1200);
  await page.screenshot({ path: OUT + '/60a-desktop-workspace.png' });
  const clickTab = async (label, file) => {
    await page.evaluate((l) => { [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === l)?.click(); }, label);
    await sleep(900);
    await page.screenshot({ path: OUT + '/' + file });
  };
  await clickTab('Tasks', '60d-desktop-tasks.png');
  await clickTab('Files', '60e-desktop-files.png');
  await clickTab('Team', '60f-desktop-team.png');
  await clickTab('Settings', '60g-desktop-settings.png');
  await clickTab('Chat', '60h-desktop-chat.png');
  await page.evaluate(() => { [...document.querySelectorAll('button.rail-nav')].find((b) => b.textContent.trim() === 'Discover')?.click(); });
  await sleep(900);
  await page.screenshot({ path: OUT + '/60i-desktop-discover.png' });
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Projects')?.click(); });
  await sleep(800);
  await page.screenshot({ path: OUT + '/60b-desktop-home.png' });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('about:blank');
  await page.goto('http://127.0.0.1:5177/#demo=ram');
  await page.waitForFunction(() => document.body.innerText.includes('Habit Tracker'), { timeout: 30000 });
  await sleep(1000);
  await page.screenshot({ path: OUT + '/60c-mobile-workspace.png' });
  console.log('PASS design shots');
} finally { if (browser) await browser.close(); srv.kill(); vite.kill(); }
