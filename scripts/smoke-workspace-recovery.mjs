import {_electron as electron} from 'playwright';import electronPath from 'electron';
import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {waitState,openSettings} from './test-helpers.mjs';
const root=await mkdtemp(join(tmpdir(),'softfex-selection-'));const first=join(root,'first'),second=join(root,'second');
await mkdir(join(first,'src'),{recursive:true});await mkdir(second);
const safe=await readFile('tests/fixtures/safe-auth.ts','utf8'),unsafe=await readFile('tests/fixtures/vulnerable-auth.ts','utf8');await writeFile(join(first,'src/auth.ts'),safe);
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();await page.getByRole('button',{name:/Open SoftFex/}).click();
 async function pick(workspace){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},workspace);return page.evaluate(()=>window.softfex.selectWorkspace());}
 assert.equal((await pick(first)).ok,true);await waitState(page,s=>s.workspace===first);
 await writeFile(join(first,'src/auth.ts'),unsafe);await waitState(page,s=>s.changedFiles===1);
 await page.getByRole('button',{name:'Review Now',exact:true}).click();let state=await waitState(page,s=>s.phase==='report_ready');
 const reviewId=state.report.reviewId,findingId=state.report.findings[0].id;
 await openSettings(page);await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},join(root,'missing'));
 await page.getByRole('button',{name:'Change project',exact:true}).click();
 state=await waitState(page,s=>!!s.error);assert.equal(state.workspace,first);assert.equal(state.report.reviewId,reviewId,'Failed replacement must retain the last usable report.');
 await writeFile(join(first,'src/auth.ts'),safe);await waitState(page,s=>s.workspace===first&&s.phase==='report_outdated'&&s.changedFiles===1);
 await writeFile(join(first,'src/auth.ts'),unsafe);await page.getByRole('button',{name:'Review Again',exact:true}).click();state=await waitState(page,s=>s.phase==='report_ready'&&s.report.reviewId!==reviewId);
 const currentId=state.report.findings[0].id;
 // Delay a single evidence read in main, then replace the selected project.
 // This is synthetic race injection; both fixture folders are controlled.
 await app.evaluate((_electron,target)=>{
  const fs=process.getBuiltinModule('fs/promises');const original=fs.lstat;
  globalThis.__qaLstatOriginal=original;
  fs.lstat=async function(path,...args){if(String(path)===target){await new Promise(resolve=>{globalThis.__qaReleaseLstat=resolve;});}return original.call(this,path,...args);};
 },join(first,'src/auth.ts'));
 const copying=page.evaluate(id=>window.softfex.getFixPrompt(id),currentId);
 await app.evaluate(async()=>{const deadline=Date.now()+3000;while(!globalThis.__qaReleaseLstat&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));if(!globalThis.__qaReleaseLstat)throw new Error('Controlled evidence-read delay did not activate.');});
 assert.equal((await pick(second)).ok,true);await waitState(page,s=>s.workspace===second);
 await app.evaluate(()=>{process.getBuiltinModule('fs/promises').lstat=globalThis.__qaLstatOriginal;globalThis.__qaReleaseLstat();delete globalThis.__qaReleaseLstat;delete globalThis.__qaLstatOriginal;});
 const result=await copying;assert.equal(result.ok,false,'A finding from the previous project must not be copied after project replacement.');
 state=await page.evaluate(()=>window.softfex.getState());assert.equal(state.workspace,second);assert.equal(state.report,undefined);assert.equal(state.phase,'watching','Rejected old evidence must not mark the replacement project outdated.');
 console.log('PASS: invalid project replacement preserves the working watcher/report; later source edits still register. Injected workspace-switch/evidence-read race rejects the prior finding without corrupting replacement state. Native folder picker is tested separately.');
}finally{
 await app.evaluate(()=>{if(globalThis.__qaLstatOriginal)process.getBuiltinModule('fs/promises').lstat=globalThis.__qaLstatOriginal;globalThis.__qaReleaseLstat?.();}).catch(()=>{});
 await app.close();await rm(root,{recursive:true,force:true});
}
