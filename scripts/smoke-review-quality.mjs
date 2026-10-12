import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import vm from 'node:vm';import ts from 'typescript';
import {runCodex} from './codex-test-helper.mjs';import {waitState,openSettings} from './test-helpers.mjs';
const root=await mkdtemp(join(tmpdir(),'softfex-two-defects-'));await mkdir(join(root,'src'));await mkdir('artifacts',{recursive:true});
const file='src/numbers.ts';await writeFile(join(root,file),'// Numeric utilities.\nexport {};\n');
const proposed=`// Arithmetic mean of a nonempty numeric array; caller validates inputs.
export function average(values: number[]) {
  return values.reduce((sum, n) => sum + n, 0) / (values.length - 1);
}
// Return a new array in ascending numeric order without mutating the input.
export function numericAscending(values: number[]) {
  return [...values].sort();
}
`;
const evidence={startedAt:new Date().toISOString(),environment:process.env.SOFTFEX_TEST_EXECUTABLE?'packaged outside repository':'source Electron',steps:[]};let app;
function behavior(source){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports},{timeout:100});const input=[2,10];return {mean:exports.average([2,4,6]),ordered:Array.from(exports.numericAscending(input)),input};}
try{
 app=await electron.launch({executablePath:process.env.SOFTFEX_TEST_EXECUTABLE||electronPath,args:process.env.SOFTFEX_TEST_EXECUTABLE?[]:['.']});const page=await app.firstWindow();
 await page.getByRole('button',{name:/Open SoftFex/}).click();await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root&&s.integration==='listening');await openSettings(page);await page.getByRole('checkbox',{name:/Enable AI review/}).click();await waitState(page,s=>s.aiEnabled);
 async function turn(label,prompt){const prior=(await page.evaluate(()=>window.softfex.getState())).report?.reviewId;const start=Date.now();const codex=await runCodex(root,prompt,{timeout:120000,wrapper:process.env.SOFTFEX_TEST_WRAPPER});const currentSource=await readFile(join(root,file),"utf8");evidence.latestTurn={label,codex:codex.summary,source:currentSource,behavior:behavior(currentSource),state:await page.evaluate(async()=>{const s=await window.softfex.getState();return {phase:s.phase,changedFiles:s.changedFiles,integration:s.integration,reviewId:s.report?.reviewId,trigger:s.report?.trigger};})};const state=await waitState(page,s=>s.report?.reviewId!==prior&&s.report?.trigger==='codex_turn_complete'&&s.phase!=='reviewing',100000);assert.equal(state.report.aiStatus,'completed');assert.equal(state.report.status,'complete');assert.deepEqual(state.report.reviewedFiles,[file]);const source=await readFile(join(root,file),'utf8');evidence.steps.push({label,reviewMs:state.report.finishedAt-state.report.startedAt,totalMs:Date.now()-start,source,behavior:behavior(source),coverage:{mode:state.report.mode,reviewed:state.report.reviewedFiles,skipped:state.report.skippedFiles},findings:state.report.findings.map(f=>({id:f.id,title:f.title,origin:f.origin,file:f.file,line:f.startLine,evidence:f.evidence})),previous:state.report.previousFindings.map(p=>({id:p.finding.id,status:p.status,reason:p.reason}))});console.log(`Live ${label}: ${state.report.findings.length} findings; ${state.report.aiStatus}.`);return state;}
 async function copiedPrompt(finding){assert.equal((await page.evaluate(id=>window.softfex.copyPrompt(id),finding.id)).ok,true);const actual=await app.evaluate(({clipboard})=>clipboard.readText());const expected=await page.evaluate(id=>window.softfex.getFixPrompt(id),finding.id);assert.equal(expected.ok,true);assert.equal(actual,expected.value);assert.ok(actual.includes(finding.file)&&actual.includes(finding.evidence));return actual;}
 let state=await turn('two-defect-change','Implement src/numbers.ts with exactly this proposed numeric utility implementation. Do not edit other files, run code, install dependencies, or access outside this isolated workspace. Save and finish.\n'+proposed);
 const bad=behavior(await readFile(join(root,file),'utf8'));assert.equal(bad.mean,6);assert.deepEqual(bad.ordered,[10,2]);assert.deepEqual(bad.input,[2,10]);
 assert.equal(state.report.findings.length,2,'Exactly the two independently reproducible defects should be reported; extra claims require investigation.');assert.ok(state.report.findings.every(f=>f.origin==='ai'));
 const first=state.report.findings.find(f=>f.evidence.includes('values.length - 1'));const second=state.report.findings.find(f=>f.evidence.includes('sort('));assert.ok(first&&second&&first.id!==second.id);
 if(process.env.SOFTFEX_TEST_EXECUTABLE){
  const navigation=await page.evaluate(id=>window.softfex.openFinding(id),first.id);assert.equal(navigation.ok,true);evidence.navigation='Actual source navigation request accepted by editor launcher';
 }
 const firstPrompt=await copiedPrompt(first);evidence.firstActualPromptReachedCodex=true;
 state=await turn('first-defect-only-correction','Only correct the average function in src/numbers.ts using this actual SoftFex prompt. Preserve numericAscending exactly, even if you notice other issues. Do not run code, install dependencies or access other files.\n'+firstPrompt);
 const partial=behavior(await readFile(join(root,file),'utf8'));assert.equal(partial.mean,4);assert.deepEqual(partial.ordered,[10,2]);
 assert.ok(state.report.previousFindings.some(p=>p.finding.id===first.id&&p.status==='resolved_in_latest_snapshot'),'Corrected mean must receive explicit scoped resolution.');
 const remaining=state.report.findings.find(f=>f.evidence.includes('sort('));assert.ok(remaining,'Unchanged remaining sort defect must remain an active finding.');assert.equal(state.report.findings.length,1);
 const secondPrompt=await copiedPrompt(remaining);evidence.secondActualPromptReachedCodex=true;
 state=await turn('second-defect-correction','Only correct numericAscending in src/numbers.ts using this actual SoftFex prompt. Preserve average and input nonmutation. Do not run code, install dependencies or access other files.\n'+secondPrompt);
 const clean=behavior(await readFile(join(root,file),'utf8'));assert.equal(clean.mean,4);assert.deepEqual(clean.ordered,[2,10]);assert.deepEqual(clean.input,[2,10]);assert.equal(state.report.findings.length,0);assert.ok(state.report.previousFindings.some(p=>p.finding.id===remaining.id&&p.status==='resolved_in_latest_snapshot'));
 const prior=state.report.reviewId;await page.evaluate(()=>window.softfex.reviewNow());state=await waitState(page,s=>s.report?.reviewId!==prior&&s.phase!=='reviewing',100000);assert.equal(state.report.mode,'current_snapshot');assert.equal(state.report.aiStatus,'completed');assert.equal(state.report.findings.length,0);
 evidence.cleanSnapshot={aiStatus:state.report.aiStatus,findings:0,reviewed:state.report.reviewedFiles};evidence.result='PASS';console.log('PASS: two live Sonnet defects; actual prompts copied to clipboard and supplied to Codex; independent 2→1→0 behavioral and finding checks; clean current snapshot has no false positives.');
}catch(error){evidence.result='FAIL';evidence.error=error instanceof Error?error.message:'Failed';throw error;}
finally{await writeFile(resolve('artifacts',process.env.SOFTFEX_TEST_EXECUTABLE?'packaged-review-quality.json':'review-quality.json'),JSON.stringify(evidence,null,2));await app?.close();await rm(root,{recursive:true,force:true});}
