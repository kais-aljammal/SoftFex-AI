import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {waitState} from './test-helpers.mjs';
// Entirely synthetic credential, never read from local credential storage.
const syntheticKey='f'.repeat(64),root=await mkdtemp(join(tmpdir(),'softfex-private-evidence-'));await mkdir(join(root,'src'));
await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/safe-auth.ts','utf8'));
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();await app.evaluate((_electron,key)=>{process.env.DEEPGRAM_API_KEY=key;},syntheticKey);
 await page.evaluate(()=>{window.__qaStates=[];window.softfex.onStateChange(state=>window.__qaStates.push(state));});
 await page.getByRole('button',{name:/Open SoftFex/}).click();assert.equal((await page.evaluate(()=>window.softfex.setMute(true))).ok,true);
 await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root);
 const code=`export function getUser(req: { params: { id: string } }, db: { query(sql: string, values?: unknown[]): unknown }) {\n  return db.query(\`SELECT * FROM users WHERE id = \${req.params.id} AND marker = '${syntheticKey}'\`);\n}\n`;
 await writeFile(join(root,'src/auth.ts'),code);await waitState(page,s=>s.changedFiles===1);await page.getByRole('button',{name:'Review Now',exact:true}).click();
 const state=await waitState(page,s=>s.phase==='report_ready');assert.equal(state.aiEnabled,false);assert.equal(state.report.findings.length,1);
 assert.ok(!JSON.stringify(state).includes(syntheticKey),'getState must redact exact configured key even when its source variable name is neutral.');
 const events=await page.evaluate(()=>window.__qaStates);assert.ok(!JSON.stringify(events).includes(syntheticKey),'Published renderer state must redact exact configured key.');
 const finding=state.report.findings[0];assert.ok(finding.evidence.includes('[REDACTED]'));
 const prompt=await page.evaluate(id=>window.softfex.getFixPrompt(id),finding.id);assert.equal(prompt.ok,true);assert.ok(!prompt.value.includes(syntheticKey));
 assert.equal((await page.evaluate(id=>window.softfex.copyPrompt(id),finding.id)).ok,true);assert.ok(!(await app.evaluate(({clipboard})=>clipboard.readText())).includes(syntheticKey));
 assert.equal((await page.evaluate(id=>window.softfex.openFinding(id),finding.id)).ok,true,'Private raw evidence must still validate the true source hash for navigation.');
 assert.equal(await readFile(join(root,'src/auth.ts'),'utf8'),code,'Output sanitization must preserve source files.');
 console.log('PASS: synthetic configured key inside neutral SQL source is absent from renderer state/events, fix prompt and clipboard; raw source remains unchanged and exact-line navigation request stays valid. AI and speech were disabled; no live provider request.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
