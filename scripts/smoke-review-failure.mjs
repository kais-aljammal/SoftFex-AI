import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {waitState,openSettings} from './test-helpers.mjs';
// Controlled source edits with synthetic Anthropic responses; no live AI call.
const root=await mkdtemp(join(tmpdir(),'softfex-provider-failure-'));await mkdir(join(root,'src'));
const good='// Arithmetic mean of a nonempty input.\nexport function average(values: number[]) {\n  return values.reduce((sum, value) => sum + value, 0) / values.length;\n}\n',bad=good.replace('/ values.length;','/ (values.length - 1);');
await writeFile(join(root,'src/math.ts'),good);await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/safe-auth.ts','utf8'));
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',()=>errors.push('renderer error'));
 const candidate={severity:'high',confidence:'high',category:'correctness',title:'Average denominator is incorrect',file:'src/math.ts',startLine:3,endLine:3,evidence:bad.split('\n')[2],explanation:'The denominator subtracts one from the number of values.',impact:'The result is not the arithmetic mean of the supplied values.',recommendation:'Divide by values.length to satisfy the nonempty-input contract.'};
 await app.evaluate((_electron,finding)=>{
  globalThis.__qaProviderMode='success';globalThis.__qaProviderCalls=0;const original=globalThis.fetch;
  globalThis.fetch=async function(input,options){
   const url=typeof input==='string'?input:input?.url||String(input);
   if(url.startsWith('https://api.anthropic.com/')){
    globalThis.__qaProviderCalls++;
    if(globalThis.__qaProviderMode==='failure')return Response.json({error:{type:'authentication_error',message:'Synthetic private provider detail'}},{status:401});
    return Response.json({id:'synthetic-review',type:'message',role:'assistant',model:'claude-sonnet-5-5',stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({findings:[finding]})}],usage:{input_tokens:1,output_tokens:1}});
   }
   return original.call(this,input,options);
  };
 },candidate);
 await page.getByRole('button',{name:/Open SoftFex/}).click();assert.equal((await page.evaluate(()=>window.softfex.setMute(true))).ok,true);
 await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},root);await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root);
 await openSettings(page);await page.getByRole('checkbox',{name:/Enable AI review/}).click();await waitState(page,s=>s.aiEnabled);
 await writeFile(join(root,'src/math.ts'),bad);await waitState(page,s=>s.changedFiles===1);await page.getByRole('button',{name:'Review Now',exact:true}).click();
 let state=await waitState(page,s=>s.phase==='report_ready');assert.equal(state.report.aiStatus,'completed');assert.equal(state.report.findings.length,1);const prior=state.report.findings[0];assert.equal(prior.origin,'ai');
 await app.evaluate(()=>{globalThis.__qaProviderMode='failure';});await writeFile(join(root,'src/math.ts'),good);await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/vulnerable-auth.ts','utf8'));await waitState(page,s=>s.changedFiles===2);
 await page.getByRole('button',{name:'Review Again',exact:true}).click();state=await waitState(page,s=>s.phase==='report_partial');
 assert.equal(state.report.aiStatus,'failed');assert.equal(state.report.status,'partial');assert.ok(state.report.findings.some(f=>f.origin==='rule'&&f.file==='src/auth.ts'));
 assert.ok(state.report.previousFindings.some(p=>p.finding.id===prior.id&&p.status==='not_reverified'),'Failed AI coverage must not resolve a corrected prior AI finding.');
 assert.equal(state.changedFiles,2,'Failed AI review must keep both changes pending for a retry.');assert.ok(!JSON.stringify(state).includes('Synthetic private provider detail'));
 await page.getByRole('button',{name:'Collapse',exact:true}).click();await page.getByRole('button',{name:'Open SoftFex · Review incomplete',exact:true}).waitFor();
 assert.equal(await app.evaluate(()=>globalThis.__qaProviderCalls),2,'Authentication failure must not retry.');assert.deepEqual(errors,[]);
 console.log('PASS: synthetic AI authentication failure preserves local SQL finding, partial/incomplete state, pending changes and prior AI not-reverified lifecycle; no retry, private error leak or renderer crash.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
