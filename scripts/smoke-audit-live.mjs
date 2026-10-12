import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import {runCodex} from './codex-test-helper.mjs';
import {waitState,openSettings} from './test-helpers.mjs';

// Copy only this existing project's source: no env, Git metadata, production
// credentials, installs or external application effects in the reviewed workspace.
const root=await mkdtemp(join(tmpdir(),'softfex-real-project-audit-'));
await cp('src',join(root,'src'),{recursive:true});
await mkdir('artifacts',{recursive:true});
const file='src/main/watcher.ts';let app;const evidence={workspace:'isolated copy of existing SoftFex src',steps:[]};
function containment(source){
 const parsed=ts.createSourceFile('watcher.ts',source,ts.ScriptTarget.Latest,true);
 const declaration=parsed.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='insideRoot').getText(parsed);
 const code=ts.transpileModule(declaration,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,...path,path},{timeout:100});
 return exports.insideRoot(root,join(root,'..','outside','file.ts'));
}
try{
 assert.equal(containment(await readFile(join(root,file),'utf8')),false);
 app=await electron.launch({executablePath:electronPath,args:['.']});const page=await app.firstWindow();
 await page.getByRole('button',{name:/Open SoftFex/}).click();
 await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root&&s.integration==='listening');
 await openSettings(page);await page.getByRole('checkbox',{name:/Enable AI review/}).click();await waitState(page,s=>s.aiEnabled);
 async function turn(prompt){
  const prior=(await page.evaluate(()=>window.softfex.getState())).report?.reviewId;const start=Date.now();
  await runCodex(root,prompt,{timeout:120000});
  const state=await waitState(page,s=>s.report?.reviewId!==prior&&s.report?.trigger==='codex_turn_complete'&&s.phase!=='reviewing',100000);
  assert.equal(state.report.aiStatus,'completed');assert.notEqual(state.report.status,'outdated');
  evidence.steps.push({reviewMs:state.report.finishedAt-state.report.startedAt,turnAndReviewMs:Date.now()-start,mode:state.report.mode,reviewed:state.report.reviewedFiles,findings:state.report.findings.map(f=>({file:f.file,line:f.startLine,category:f.category,origin:f.origin}))});console.log(`Live automatic review completed: ${state.report.reviewedFiles.length} files; ${state.report.findings.length} findings.`);return state;
 }
 let state=await turn('Only edit src/main/watcher.ts in this isolated local project. Replace the body of insideRoot with: return !isAbsolute(relative(root,path)); Preserve its signature and every other function. Do not run code, access other files, install dependencies or make network requests. Finish after saving.');
 assert.equal(containment(await readFile(join(root,file),'utf8')),true,'Independent pure-function oracle reproduces traversal acceptance.');
 const finding=state.report.findings.find(f=>f.origin==='ai'&&f.file===file&&f.category==='security');assert.ok(finding,'Live Sonnet must identify the real containment regression.');
 const preview=await page.evaluate(id=>window.softfex.getFixPrompt(id),finding.id);assert.equal(preview.ok,true);assert.ok(preview.value.includes(file));
 assert.equal((await page.evaluate(id=>window.softfex.copyPrompt(id),finding.id)).ok,true);
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.equal(copied,preview.value);evidence.clipboard='Actual Electron clipboard matched validated correction prompt';
 state=await turn('Only edit src/main/watcher.ts. Apply this SoftFex correction prompt in the isolated project; preserve all other behavior. Do not install dependencies, access outside files or make network requests.\n'+copied);
 assert.equal(containment(await readFile(join(root,file),'utf8')),false,'Correction rejects sibling traversal.');
 const prior=state.report.previousFindings.find(p=>p.finding.id===finding.id);
 assert.ok(prior,'The original issue must remain represented after correction.');
 assert.ok(['resolved_in_latest_snapshot','not_reverified'].includes(prior.status));
 evidence.lifecycle=prior.status;
 evidence.lifecycleMeaning=prior.status==='not_reverified'?'Bounded changed-code context does not establish coverage of removed original AI evidence; uncertainty preserved.':'Issue no longer detected in reviewed code.';
 evidence.result='PASS';evidence.oracle='Pure insideRoot sibling-path check before, after regression and after fix; no outside file read or production effect';
 console.log('PASS: isolated existing SoftFex source; real wrapped Codex edit/completion, live Sonnet finding, actual clipboard, Codex correction and automatic re-review; independent containment oracle.');
}catch(error){evidence.result='FAIL';evidence.error=error instanceof Error?error.message:'Failed';throw error;}
finally{await writeFile('artifacts/audit-live.json',JSON.stringify(evidence,null,2));await app?.close();await rm(root,{recursive:true,force:true});}
