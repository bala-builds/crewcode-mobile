// Two-contribution combined-runtime E2E: three real Chrome instances (owner, frontend
// teammate, backend teammate) drive the actual UI over HTTP. Both teammates build and
// submit; the owner runs the contract check and merges both; the merged main/ tree is
// extracted and run for real (backend booted, frontend served with an /api proxy) and a
// habit is added through the merged frontend into the merged backend.
// Fixtures live in e2e/fixtures/ (a small Express habits backend + a matching frontend
// page). No AI calls, no Drive, no external services. Optional browser driver installed
// outside the app, same convention as scripts/browser-e2e.mjs.
// Run from the repo root: node e2e/two-contrib-merge.mjs
const { default: puppeteer } = await import(process.env.CREWCODE_BROWSER_DRIVER || 'puppeteer-core');
import {spawn,execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const cwd=process.cwd(), OUT=cwd+'/shots/http-e2e';
const FIX=cwd+'/e2e/fixtures';
fs.mkdirSync(OUT,{recursive:true});
if(!fs.existsSync(FIX+'/backend/node_modules')){ console.log('installing fixture backend deps (local dev only)...'); execSync('npm install',{cwd:FIX+'/backend',stdio:'inherit'}); }
execSync('npm run server:build && npm run build',{cwd,stdio:'ignore',shell:'/bin/bash'});
const data='/tmp/crewcode-2contrib-'+Date.now()+'.json';
const srv=spawn('node',['dist-server/index.js'],{cwd,env:{...process.env,PORT:'8787',CREWCODE_DATA:data},stdio:'ignore'});
const stat=spawn('node',['-e',`
const http=require('http'),fs=require('fs'),path=require('path');
const root=process.argv[1];
http.createServer((req,res)=>{
 if(req.method==='POST'&&req.url==='/api'){const c=[];req.on('data',x=>c.push(x));req.on('end',async()=>{const r=await fetch('http://127.0.0.1:8787/api',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.concat(c)});res.writeHead(r.status,{'content-type':'application/json'});res.end(Buffer.from(await r.arrayBuffer()));});return;}
 let f=path.join(root,req.url==='/'?'index.html':decodeURIComponent(req.url.split('?')[0]));
 if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html');
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(f)]||'application/octet-stream';
 res.writeHead(200,{'content-type':mime});res.end(fs.readFileSync(f));
}).listen(5174,'127.0.0.1');`,cwd+'/dist'],{cwd,stdio:'ignore'});
const api=async(body)=>{const r=await fetch('http://127.0.0.1:8787/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!j.ok)throw Error(body.op+': '+JSON.stringify(j));return j.data;};
async function click(p,t){await p.waitForFunction(t=>[...document.querySelectorAll('button,[role=tab]')].some(b=>b.textContent.trim()===t&&!b.disabled),{timeout:20000},t);const hs=await p.$$('button,[role=tab]');for(const h of hs){if(await h.evaluate((b,t)=>b.textContent.trim()===t,t)){await h.click();return;}}throw Error('missing '+t);}
async function type(p,sel,v){await p.waitForSelector(sel,{timeout:10000});await p.click(sel,{clickCount:3});await p.type(sel,v);}
async function typeReplace(p,sel,v){await p.waitForSelector(sel,{timeout:10000});await p.click(sel);await p.keyboard.down('Control');await p.keyboard.press('KeyA');await p.keyboard.up('Control');await p.type(sel,v);}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const shot=async(p,name)=>{await p.screenshot({path:OUT+'/'+name});console.log('SHOT',name,new Date().toISOString());};
const setEditor=async(p,v)=>{await p.evaluate((v)=>{const ta=document.querySelector('textarea.editor');const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,v);ta.dispatchEvent(new Event('input',{bubbles:true}));},v);await sleep(400);};
const FRONTEND=fs.readFileSync(FIX+'/frontend/index.html','utf8');
const BACKEND_FILES=['config.js','index.js','package.json','routes/habits.js','data/store.js'];
const SETTINGS_FILES=['config.js','index.js','package.json','routes/settings.js','data/store.js'];
let bA,bB,bC;
try{
 for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:5174/');if(r.ok)break;}catch{}await sleep(250);}
 const launch=()=>puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 bA=await launch(); bB=await launch(); bC=await launch();
 const A=await (await bA.createBrowserContext()).newPage();   // Ram owner
 const B=await (await bB.createBrowserContext()).newPage();   // Seeta frontend
 const C=await (await bC.createBrowserContext()).newPage();   // Hanuma backend
 for(const p of [A,B,C]) await p.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await Promise.all([A.goto('http://127.0.0.1:5174'),B.goto('http://127.0.0.1:5174'),C.goto('http://127.0.0.1:5174')]);
 for(const p of [A,B,C]) await p.waitForFunction(()=>document.body.innerText.includes('Test identities only'),{timeout:15000});
 await click(A,'Ram'); await A.waitForFunction(()=>document.body.innerText.includes('Habit Tracker'),{timeout:15000});
 for(const h of await A.$$('button.card')){ if(await h.evaluate(e=>e.textContent.includes('Habit Tracker'))){await h.click();break;} }
 await click(B,'Seeta'); await B.waitForFunction(()=>document.body.innerText.includes('Habit Tracker'),{timeout:15000});
 for(const h of await B.$$('button.card')){ if(await h.evaluate(e=>e.textContent.includes('Habit Tracker'))){await h.click();break;} }
 await click(C,'Hanuma'); await click(C,'Join project'); await type(C,'#tc','DEM-123'); await click(C,'backend'); await click(C,'Join');
 await C.waitForFunction(()=>document.body.innerText.includes('Choose your AI'),{timeout:10000});
 await C.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue'&&!b.disabled),{timeout:10000});
 for(const h of await C.$$('button')){ if(await h.evaluate(e=>e.textContent.trim()==='Continue')){await h.click();break;} }
 await C.waitForFunction(()=>document.body.innerText.includes('Habit Tracker'),{timeout:15000});
 console.log('THREE-IN', new Date().toISOString());
 // owner assigns both tasks via the UI
 await A.waitForFunction(()=>document.body.innerText.includes('Assign tasks'),{timeout:15000});
 for(const h of await A.$$('button')){ if((await h.evaluate(e=>e.textContent.trim())).startsWith('Assign tasks')){await h.click();break;} }
 const pid=(await api({as:'u-ram',op:'listProjects'}))[0].id;
 let seetaTask,hanumaTask;
 for(let i=0;i<25;i++){ const q=await api({as:'u-ram',op:'getProject',args:{projectId:pid}}); seetaTask=q.tasks.find(t=>t.assigneeId==='u-seeta'); hanumaTask=q.tasks.find(t=>t.assigneeId==='u-hanuma'); if(seetaTask&&hanumaTask) break; await sleep(1000); }
 if(!seetaTask||!hanumaTask) throw Error('tasks not assigned to both teammates');
 console.log('TASKS', seetaTask.title,'|',seetaTask.folder,'//',hanumaTask.title,'|',hanumaTask.folder);
 // Seeta: simulated build (home/index.html + home/api.ts), overwrite home/index.html in the
 // Code editor, then create the five fixture backend files in home/ via New file - all UI.
 await B.waitForFunction(()=>document.body.innerText.includes('Run simulated build'),{timeout:40000});
 await click(B,'Run simulated build');
 for(let i=0;i<30;i++){ const q=await api({as:'u-seeta',op:'getProject',args:{projectId:pid}}); if(q.files['home/index.html']) break; await sleep(1000); }
 await click(B,'Code');
 await shot(B,'34a-teammate-new-file-available.png');
 await B.waitForFunction(()=>[...document.querySelectorAll('button.chip')].some(b=>b.textContent.includes('home/index.html')),{timeout:15000});
 for(const h of await B.$$('button.chip')){ if(await h.evaluate(e=>e.textContent.includes('home/index.html'))){await h.click();break;} }
 await B.waitForSelector('textarea.editor',{timeout:10000});
 await setEditor(B,FRONTEND);
 await click(B,'Save');
 await B.waitForFunction(()=>!document.body.innerText.includes('Unsaved changes'),{timeout:10000});
 for(const f of BACKEND_FILES){
   const content=fs.readFileSync(FIX+'/backend/'+f,'utf8');
   await click(B,'New file');
   await typeReplace(B,'input[aria-label="New file path"]','home/'+f);
   await click(B,'Create');
   await B.waitForFunction((n)=>{const el=[...document.querySelectorAll('.row.spread strong')].find(e=>e.textContent===n);return !!el;},{timeout:10000},'home/'+f);
   await B.waitForSelector('textarea.editor',{timeout:8000});
   await setEditor(B,content);
   await click(B,'Save');
   await B.waitForFunction(()=>!document.body.innerText.includes('Unsaved changes'),{timeout:10000});
   console.log('CREATED', 'home/'+f);
 }
 await click(B,'Tasks'); await click(B,'done'); await sleep(600); await click(B,'Submit for merge');
 await B.waitForFunction(()=>document.body.innerText.includes('Sent for merge review'),{timeout:15000});
 console.log('SEETA-SUBMITTED', new Date().toISOString());
 // Hanuma: simulated build (settings/ placeholder), then the five fixture settings-service
 // files created in settings/ via New file - the settings feature really runs later.
 await C.waitForFunction(()=>document.body.innerText.includes('Run simulated build'),{timeout:40000});
 await click(C,'Run simulated build');
 for(let i=0;i<30;i++){ const q=await api({as:'u-hanuma',op:'getProject',args:{projectId:pid}}); if(q.files['settings/index.html']) break; await sleep(1000); }
 await click(C,'Code');
 for(const f of SETTINGS_FILES){
   const content=fs.readFileSync(FIX+'/settings/'+f,'utf8');
   await click(C,'New file');
   await typeReplace(C,'input[aria-label="New file path"]','settings/'+f);
   await click(C,'Create');
   await C.waitForFunction((n)=>{const el=[...document.querySelectorAll('.row.spread strong')].find(e=>e.textContent===n);return !!el;},{timeout:10000},'settings/'+f);
   await C.waitForSelector('textarea.editor',{timeout:8000});
   await setEditor(C,content);
   await click(C,'Save');
   await C.waitForFunction(()=>!document.body.innerText.includes('Unsaved changes'),{timeout:10000});
   console.log('CREATED', 'settings/'+f);
 }
 await click(C,'Tasks'); await click(C,'done'); await sleep(600); await click(C,'Submit for merge');
 await C.waitForFunction(()=>document.body.innerText.includes('Sent for merge review'),{timeout:15000});
 console.log('HANUMA-SUBMITTED', new Date().toISOString());
 // Owner: wait until BOTH submissions render, then screenshot (learned from shot 32b).
 await click(A,'Tasks');
 await A.waitForFunction(()=>{const t=document.body.innerText; return t.includes('home/')&&t.includes('settings/')&&(t.match(/submitted/g)||[]).length>=2;},{timeout:40000});
 await shot(A,'34b-owner-sees-both-submissions.png');
 for(const folder of ['home/','settings/']){
   await click(A,'Run check');
   await A.waitForFunction(()=>document.body.innerText.includes('ready'),{timeout:15000});
   await click(A,'Merge into main');
   await A.waitForFunction(()=>document.body.innerText.includes('Merged into main/'),{timeout:15000});
   console.log('MERGED', folder, new Date().toISOString());
 }
 await shot(A,'34c-owner-merged-both.png');
 // verify the physical main tree byte-matches the fixtures
 const proj=await api({as:'u-ram',op:'getProject',args:{projectId:pid}});
 const checks={};
 checks['main/home/index.html']=proj.files['main/home/index.html']===FRONTEND;
 for(const f of BACKEND_FILES) checks['main/home/'+f]=proj.files['main/home/'+f]===fs.readFileSync(FIX+'/backend/'+f,'utf8');
 for(const f of SETTINGS_FILES) checks['main/settings/'+f]=proj.files['main/settings/'+f]===fs.readFileSync(FIX+'/settings/'+f,'utf8');
 console.log('MAIN-TREE', JSON.stringify(checks));
 if(Object.values(checks).some(v=>!v)) throw Error('main tree mismatch');
 // combined runtime: extract merged main/, boot the merged backend, serve the merged
 // frontend with an /api proxy, and add a habit through the UI of the merged app
 fs.rmSync('/tmp/combined-main',{recursive:true,force:true});
 for(const [pth,c] of Object.entries(proj.files)) if(pth.startsWith('main/')){ const fp='/tmp/combined-main/'+pth.slice(5); fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,c); }
 fs.symlinkSync(FIX+'/backend/node_modules','/tmp/combined-main/home/node_modules');
 fs.symlinkSync(FIX+'/backend/node_modules','/tmp/combined-main/settings/node_modules');
 const be=spawn('node',['index.js'],{cwd:'/tmp/combined-main/home',env:{...process.env,PORT:'4123'},stdio:'ignore'});
 const beS=spawn('node',['index.js'],{cwd:'/tmp/combined-main/settings',env:{...process.env,PORT:'4124'},stdio:'ignore'});
 const fe=spawn('node',['-e',`
const http=require('http'),fs=require('fs');
http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){ const c=[]; req.on('data',x=>c.push(x)); req.on('end',async()=>{ const target=req.url.startsWith('/api/v1/settings')?'http://127.0.0.1:4124':'http://127.0.0.1:4123'; const r=await fetch(target+req.url,{method:req.method,headers:{'content-type':'application/json'},body:req.method==='GET'?undefined:Buffer.concat(c)}); res.writeHead(r.status,{'content-type':'application/json'}); res.end(Buffer.from(await r.arrayBuffer())); }); return; }
 res.writeHead(200,{'content-type':'text/html'}); res.end(fs.readFileSync('/tmp/combined-main/home/index.html'));
}).listen(5201,'127.0.0.1');`],{stdio:'ignore'});
 await sleep(1200);
 const R=await (await bA.createBrowserContext()).newPage();
 await R.goto('http://127.0.0.1:5201/'); await sleep(1500);
 await R.type('#n','Drink water'); await R.click('#add'); await sleep(1500);
 const listTxt=await R.evaluate(()=>document.getElementById('list').innerText);
 const viaApi=await (await fetch('http://127.0.0.1:4123/api/v1/habits')).json();
 const viaSettings=await (await fetch('http://127.0.0.1:4124/api/v1/settings')).json();
 const whoTxt=await R.$eval('#who',e=>e.textContent);
 console.log('COMBINED-LIST', JSON.stringify(listTxt), '| home backend sees', viaApi.length, 'habit(s):', JSON.stringify(viaApi.map(h=>h.name)), '| settings backend says', JSON.stringify(viaSettings), '| page shows:', JSON.stringify(whoTxt));
 await shot(R,'34f-combined-app-running.png');
 if(!listTxt.includes('Drink water')||viaApi.length!==1) throw Error('combined runtime failed');
 if(viaSettings.displayName!=='Balu'||!whoTxt.includes('Balu')) throw Error('cross-feature journey failed: settings feature not serving the merged page');
 be.kill(); beS.kill(); fe.kill();
 console.log('TWO-CONTRIB-COMBINED-TEST PASSED');
}catch(e){ console.error('FAILED:', e.message); try{await shot(A,'34-fail-A.png');}catch{} try{await shot(B,'34-fail-B.png');}catch{} try{await shot(C,'34-fail-C.png');}catch{} process.exitCode=1; }
finally{ try{await bA?.close();await bB?.close();await bC?.close();}catch{} srv.kill(); stat.kill(); }
