// Optional browser driver, installed outside the app. No CI or hosted services.
const { default: puppeteer } = await import(process.env.CREWCODE_BROWSER_DRIVER || 'puppeteer-core');
import {spawn,execSync} from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const cwd=process.cwd(), OUT=cwd+'/shots/http-e2e';fs.mkdirSync(OUT,{recursive:true});
execSync('npm run server:build',{cwd,stdio:'ignore'});
const data='/tmp/crewcode-browser-e2e-'+Date.now()+'.json';
const srv=spawn('node',['dist-server/index.js'],{cwd,env:{...process.env,PORT:'8787',CREWCODE_DATA:data},stdio:'ignore'});
const vite=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{cwd,stdio:'ignore'});
let browser; const errors=[],requests=[],responses=[];
const waitText=async(p,t)=>p.waitForFunction(t=>document.body.innerText.includes(t),{timeout:8000},t);
async function click(p,t){await p.waitForFunction(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===t&&!b.disabled),{timeout:8000},t);const handles=await p.$$('button');for(const h of handles){if(await h.evaluate((b,t)=>b.textContent.trim()===t,t)){await h.click();return;}}throw Error('missing '+t);}
async function tab(p,t){await p.click(`[role=tab]:nth-child(${['Chat','Code','Preview','Tasks'].indexOf(t)+1})`);}
async function shot(p,n){await p.screenshot({path:OUT+'/'+n+'.png'});}
async function page(){const c=await browser.createBrowserContext();const p=await c.newPage();await p.setViewport({width:390,height:844,deviceScaleFactor:1});p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/api') && r.postData())requests.push(JSON.parse(r.postData()));});p.on('response',async r=>{if(r.url().endsWith('/api')){try{responses.push(await r.json());}catch{}}});await p.goto('http://127.0.0.1:5173');return p;}
try{
 for(let i=0;i<50;i++){try{await fetch('http://127.0.0.1:5173');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const owner=await page();await click(owner,'Ram');await click(owner,'Create project');await owner.type('#pn','Browser HTTP App');await owner.type('#prd','A small shared roadmap with frontend and backend.');await click(owner,'Create');await waitText(owner,'Project created');const code=await owner.$eval('.code',e=>e.textContent.trim());await shot(owner,'01-owner-created');await click(owner,'Choose AI model');await click(owner,'Continue');await waitText(owner,'Ready to divide the work?');
 const teammate=await page();await click(teammate,'Seeta');await click(teammate,'Join project');await teammate.type('#tc',code);await click(teammate,'frontend');await click(teammate,'Join');await click(teammate,'Continue');await waitText(teammate,'You have no task yet.');await shot(teammate,'02-teammate-joined');
 // Views refresh when entered, not real-time subscriptions.
 await click(owner,'Back');await owner.reload();await waitText(owner,'Browser HTTP App');const card=await owner.$$('button.card');for(const h of card){if(await h.evaluate(e=>e.textContent.includes('Browser HTTP App'))){await h.click();break;}}
 await click(owner,'Assign tasks (simulated)');await waitText(owner,'Seeta');await shot(owner,'03-owner-assigned');
 await click(teammate,'Back');await teammate.reload();await waitText(teammate,'Browser HTTP App');for(const h of await teammate.$$('button.card')){if(await h.evaluate(e=>e.textContent.includes('Browser HTTP App'))){await h.click();break;}}
 await click(teammate,'Run simulated build');await waitText(teammate,'simulated build');await shot(teammate,'04-teammate-build');
 await tab(teammate,'Code');await waitText(teammate,'frontend/index.html');await click(teammate,'frontend/index.html');const editor=await teammate.$('.editor');await editor.click();await teammate.keyboard.down('Control');await teammate.keyboard.press('KeyA');await teammate.keyboard.up('Control');await teammate.keyboard.type('<h1>HTTP browser edit</h1>');await click(teammate,'Save');await teammate.waitForFunction(()=>!document.body.innerText.includes('Unsaved changes'));await shot(teammate,'05-teammate-saved');
 const saved=JSON.parse(fs.readFileSync(data));const pr=saved.projects.find(p=>p.name==='Browser HTTP App');assert.equal(pr.files['frontend/index.html'],'<h1>HTTP browser edit</h1>');
 const scoped=requests.filter(r=>r.as==='u-seeta'&&r.op==='getProject');assert(scoped.length>0);const views=responses.filter(r=>r.ok&&r.data?.role==='teammate');assert(views.length>0);assert(views.every(r=>r.data.teamCode===undefined));assert(views.every(r=>Object.keys(r.data.files).every(f=>!f.startsWith('backend/'))));
 await click(teammate,'PRD.md');assert(await teammate.$eval('.editor',e=>e.readOnly));await shot(teammate,'06-teammate-root-readonly');await tab(teammate,'Preview');await waitText(teammate,'frontend/index.html');await shot(teammate,'07-preview');
 const frame=await (await teammate.$('iframe')).contentFrame();
 const isolation=await frame.evaluate(async()=>{
   let parentBlocked=false, storageBlocked=false, corsBlocked=false;
   try{void parent.document.body;}catch{parentBlocked=true;}
   try{void localStorage.length;}catch{storageBlocked=true;}
   try{await fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({as:'u-ram',op:'listUsers'})});}catch{corsBlocked=true;}
   return {parentBlocked,storageBlocked,corsBlocked};
 });
 assert(isolation.parentBlocked&&isolation.storageBlocked&&isolation.corsBlocked,JSON.stringify(isolation));
 // A sandbox is NOT a network firewall. Simple no-cors POST can reach loopback,
 // but media-type validation must prevent it from making an API mutation.
 const before=JSON.parse(fs.readFileSync(data)).users.length;
 await frame.evaluate(async()=>{await fetch('http://127.0.0.1:8787/api',{mode:'no-cors',method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({as:'u-ram',op:'registerName',args:{name:'Iframe injected'}})}).catch(()=>{});});
 assert.equal(JSON.parse(fs.readFileSync(data)).users.length,before);
 for(const p of [owner,teammate]){const dims=await p.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));assert(dims.scroll<=dims.width,JSON.stringify(dims));}
 assert.equal(errors.length,0,errors.join('\n'));assert(requests.some(r=>r.op==='createProject'));assert(requests.some(r=>r.op==='saveFile'));assert(requests.some(r=>r.op==='joinProject'));
 srv.kill(); await new Promise(r=>srv.once('close',r));
 const offline=await page(); await waitText(offline,'The local server could not be reached.'); await shot(offline,'08-offline-error');
 fs.writeFileSync(OUT+'/report.json',JSON.stringify({result:'PASS',requests:requests.map(r=>({as:r.as,op:r.op})),checks:['two isolated browser identities','create and invite','teammate join','owner assign','simulated build over HTTP','teammate edit persisted in server JSON','teammate redacted responses','root read-only','preview renders','390px no horizontal page overflow','no uncaught page errors','opaque iframe parent/storage blocked','iframe JSON CORS blocked','simple iframe POST cannot mutate API','offline error visible'],errors},null,2));console.log('PASS',requests.length,'HTTP calls',OUT);
}catch(e){console.error(e);if(browser){for(const c of browser.browserContexts())for(const p of await c.pages())await p.screenshot({path:OUT+'/failure-'+Date.now()+'.png'}).catch(()=>{});}process.exitCode=1;}finally{await browser?.close();srv.kill();vite.kill();}
