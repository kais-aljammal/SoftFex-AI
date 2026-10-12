import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import {runCodex} from './codex-test-helper.mjs';
import {waitState,openSettings} from './test-helpers.mjs';
import {observeVoice,voiceEvidence} from './voice-observer.mjs';

// Representative live acceptance scenarios. The reviewed AI receives actual
// changed source and normal task context, never our expected finding/assertions.
const root=await mkdtemp(join(tmpdir(),'softfex-live-sprint-'));
await mkdir(join(root,'src'));await mkdir('artifacts',{recursive:true});
const securityFile='src/auth.ts';
const safeSql=await readFile('tests/fixtures/safe-auth.ts','utf8');
const unsafeSql=await readFile('tests/fixtures/vulnerable-auth.ts','utf8');
const correctMath='// Arithmetic mean of a nonempty array. Inputs are validated by the caller.\nexport function average(values: number[]) {\n  return values.reduce((sum, value) => sum + value, 0) / values.length;\n}\n';
const badMath=correctMath.replace('/ values.length;','/ (values.length - 1);');
const correctApi=`export type User = {id: string; name: string};
export type HttpResponse = {ok: boolean; status: number; json(): Promise<unknown>};
// Contract: the injected GET returns a valid User on 200 and {error: string} on 404/500.
// The caller displays the returned User; an unsuccessful response must reject.
export async function loadUser(get: (url: string) => Promise<HttpResponse>, id: string): Promise<User> {
  const response = await get('/users/' + encodeURIComponent(id));
  if (!response.ok) throw new Error('User request failed: ' + response.status);
  return await response.json() as User;
}
`;
const badApi=correctApi.replace("  if (!response.ok) throw new Error('User request failed: ' + response.status);\n",'');
await writeFile(join(root,securityFile),safeSql);
await writeFile(join(root,'src/math.ts'),correctMath);
await writeFile(join(root,'src/user-api.ts'),correctApi);
const metrics=[];let completed=false;let qaPage;let securityVoiceEvidence;
const hostileId='1 OR 1=1';
function queryCalls(source,id){
 const calls=[];
 const database={query(sql,values){calls.push({sql,values});return undefined;}};
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 // Execute both module initialization and getUser under the VM deadline.
 vm.runInNewContext(`${compiled}\nexports.getUser(request, database);`,{exports:{},request:{params:{id}},database},{timeout:100});
 assert.equal(calls.length,1,'The controlled fixture should issue one user query.');assert.equal(typeof calls[0].sql,'string');
 return calls[0];
}
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();qaPage=page;const rendererErrors=[];page.on('pageerror',()=>rendererErrors.push('renderer error'));
 await page.getByRole('button',{name:/Open SoftFex/}).click();
 await app.evaluate(({dialog},workspace)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[workspace]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();
 let state=await waitState(page,s=>s.workspace===root&&s.integration==='listening');
 assert.ok(state.apiKeyPresent,'Live Sonnet scenarios require locally configured Anthropic credentials.');
 assert.ok(state.deepgramKeyPresent,'Scenario A requires locally configured Deepgram credentials.');
 await openSettings(page);await page.getByRole('checkbox',{name:/Enable AI review/}).click();await waitState(page,s=>s.aiEnabled);
 await observeVoice(app,page);

 async function turn(label,prompt){
  console.log(`START: ${label}`);
  const before=(await page.evaluate(()=>window.softfex.getState())).report?.reviewId;
  const started=Date.now();await runCodex(root,prompt,{timeout:120000});
  const result=await waitState(page,s=>s.report?.reviewId!==before&&s.report?.trigger==='codex_turn_complete'&&s.phase!=='reviewing',120000);
  assert.equal(result.report.aiStatus,'completed',result.report.note);
  assert.equal(result.report.status,'complete','Representative fixtures must receive complete, current coverage.');
  metrics.push({scenario:label,codexAndReviewMs:Date.now()-started,reviewMs:result.report.finishedAt-result.report.startedAt,findings:result.report.findings.map(f=>({origin:f.origin,category:f.category,file:f.file,startLine:f.startLine,endLine:f.endLine,severity:f.severity,title:f.title}))});
  console.log(`REVIEW: ${label}; ${result.report.findings.length} findings; ${result.report.finishedAt-result.report.startedAt}ms; live Sonnet completed.`);
  return result;
 }
 const replace=(file,source)=>`This is a controlled local test fixture. Modify ONLY ${file} to contain exactly the following TypeScript source. Do not change any other file, install dependencies, or access files outside this workspace. Finish after saving.\n\n${source}`;
 async function correctFinding(label,current,finding){
  if(await page.locator('.finding').count()===0){
   const open=page.getByRole('button',{name:/^Open SoftFex/});
   if(await open.count())await open.click();
  }
  await page.locator('.finding').filter({hasText:finding.title}).first().click();
  await page.getByRole('heading',{name:"What's wrong",exact:true}).waitFor();
  await page.getByRole('button',{name:'Fix prompt',exact:true}).click();
  const prompt=await page.getByRole('textbox',{name:'Fix prompt',exact:true}).inputValue();
  assert.ok(prompt.includes(finding.file));assert.ok(prompt.includes(finding.evidence));
  await page.getByRole('button',{name:'Copy prompt',exact:true}).click();await page.getByRole('button',{name:'Copied',exact:true}).waitFor();
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),prompt);
  const opened=await page.evaluate(id=>window.softfex.openFinding(id),finding.id);assert.equal(opened.ok,true,'Exact current finding must produce an accepted source navigation request.');
  const next=await turn(label,`Only edit ${finding.file} in this controlled fixture. Do not access other files or install dependencies. Apply this real SoftFex fix prompt and preserve existing contracts:\n\n${prompt}`);
  assert.ok(next.report.previousFindings.some(p=>p.finding.id===finding.id&&p.status==='resolved_in_latest_snapshot'),'Corrected covered finding must receive a specific resolution state.');
  assert.equal(next.report.findings.length,0,'The corrected controlled implementation should not receive unsupported warnings.');
  return next;
 }

 state=await turn('A-security-Codex-edit',replace(securityFile,unsafeSql));
 let finding=state.report.findings.find(f=>f.file===securityFile&&f.category==='security');assert.ok(finding);
 assert.equal(finding.startLine,2);assert.ok(finding.evidence.includes('req.params.id'));
 const unsafeQuery=queryCalls(await readFile(join(root,securityFile),'utf8'),hostileId);
 assert.ok(unsafeQuery.sql.includes(hostileId),'The pre-fix SQL construction must actually inline hostile input.');assert.equal(unsafeQuery.values,undefined);
 // Require actual playback/waveform overlap and completion even when the island
 // is compact. Provider identity comes from main, never an expanded-only label.
 await page.waitForFunction(()=>window.__qaAudioEvents.some(event=>event.event==='playing')&&window.__qaAudioEvents.some(event=>event.event==='ended')&&window.__qaWaveformOverlap?.active&&window.__qaWaveformOverlap?.audioPlaying&&!window.__qaAudioPlaying&&!document.querySelector('[aria-label="Voice playback active"]'),undefined,{timeout:25000});
 securityVoiceEvidence=await voiceEvidence(app,page);
 const automaticSpeech=securityVoiceEvidence.main.findLast(event=>event.event==='softfex:requestSpeech result'&&event.kind==='report');
 assert.equal(automaticSpeech?.ok,true,'Automatic finding announcement must succeed.');
 assert.equal(automaticSpeech?.provider,'deepgram','Scenario A must use real Deepgram, not browser fallback.');
 assert.ok(securityVoiceEvidence.renderer.audioEvents.some(event=>event.event==='playing'),'Native HTMLAudio must decode and enter playing state.');
 assert.ok(securityVoiceEvidence.renderer.audioEvents.some(event=>event.event==='ended'),'Native HTMLAudio must finish playback.');
 assert.ok(!securityVoiceEvidence.renderer.audioEvents.some(event=>event.event==='error'),'Native HTMLAudio must not report a decoder/playback error.');
 assert.ok(securityVoiceEvidence.renderer.waveformOverlap?.active&&securityVoiceEvidence.renderer.waveformOverlap?.audioPlaying,'Speaking waveform must overlap actual Deepgram playback.');
 await correctFinding('A-security-Codex-fix',state,finding);
 const fixedQuery=queryCalls(await readFile(join(root,securityFile),'utf8'),hostileId);
 assert.ok(!fixedQuery.sql.includes(hostileId),'The corrected SQL text must not contain the hostile value.');
 assert.ok(Array.isArray(fixedQuery.values)&&Array.from(fixedQuery.values).includes(hostileId),'The corrected query must pass the hostile value separately as a parameter.');

 state=await turn('B-correctness-Codex-edit',replace('src/math.ts',badMath));
 const mathSource=await readFile(join(root,'src/math.ts'),'utf8');assert.equal(mathSource.trim(),badMath.trim());
 const mathExports={};vm.runInNewContext(ts.transpileModule(mathSource,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:mathExports},{timeout:100});
 assert.notEqual(mathExports.average([2,4,6]),4,'Independent arithmetic oracle confirms this fixture contains a logic defect.');
 finding=state.report.findings.find(f=>f.origin==='ai'&&f.file==='src/math.ts'&&f.category!=='security');assert.ok(finding,'Sonnet must independently identify a real non-security finding.');
 await correctFinding('B-correctness-Codex-fix',state,finding);
 const fixedMath={};vm.runInNewContext(ts.transpileModule(await readFile(join(root,'src/math.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:fixedMath},{timeout:100});assert.equal(fixedMath.average([2,4,6]),4);

 state=await turn('C-API-Codex-edit',replace('src/user-api.ts',badApi));
 const apiSource=await readFile(join(root,'src/user-api.ts'),'utf8');assert.equal(apiSource.trim(),badApi.trim());
 const apiExports={};vm.runInNewContext(ts.transpileModule(apiSource,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:apiExports},{timeout:100});
 const rejectedResponse={ok:false,status:404,json:async()=>({error:'not found'})};
 assert.deepEqual(JSON.parse(JSON.stringify(await apiExports.loadUser(async()=>rejectedResponse,'missing'))),{error:'not found'},'Independent fake transport confirms error payload incorrectly escapes as User.');
 finding=state.report.findings.find(f=>f.origin==='ai'&&f.file==='src/user-api.ts');assert.ok(finding,'Sonnet must ground the API contract defect in actual source.');
 await correctFinding('C-API-Codex-fix',state,finding);
 const fixedApi={};vm.runInNewContext(ts.transpileModule(await readFile(join(root,'src/user-api.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:fixedApi},{timeout:100});await assert.rejects(fixedApi.loadUser(async()=>rejectedResponse,'missing'));
 const encodedId='user/one?role=reader & region=west',expectedUser={id:encodedId,name:'Mina'};let requestedUrl;
 const loadedUser=await fixedApi.loadUser(async url=>{requestedUrl=url;return {ok:true,status:200,json:async()=>expectedUser};},encodedId);
 assert.deepEqual(JSON.parse(JSON.stringify(loadedUser)),expectedUser,'The corrected API must preserve a valid 200 User response.');
 assert.equal(requestedUrl,'/users/'+encodeURIComponent(encodedId),'The corrected API must preserve URL encoding of the user identifier.');

 // Manual current-snapshot review intentionally covers the clean fixture set.
 const prior=(await page.evaluate(()=>window.softfex.getState())).report.reviewId;
 await page.evaluate(()=>window.softfex.reviewNow());
 state=await waitState(page,s=>s.report?.reviewId!==prior&&s.phase!=='reviewing',120000);
 assert.equal(state.report.aiStatus,'completed',state.report.note);assert.equal(state.report.status,'complete');assert.equal(state.report.findings.length,0,'D-clean fixture must not trigger the prior security, logic or API warnings.');
 metrics.push({scenario:'D-clean-current-snapshot',reviewMs:state.report.finishedAt-state.report.startedAt,findings:[]});
 assert.deepEqual(rendererErrors,[]);completed=true;
 await writeFile('artifacts/live-scenarios.json',JSON.stringify({result:'PASS',fixtureRoot:root,metrics,oracles:{security:'Bounded VM query spy: hostile value inlined before fix, separated into parameters after fix; no live database or exploitation claim',correctness:'Arithmetic mean oracle for [2,4,6]',api:'Fake transport: 404 rejects after fix; valid 200 User and encoded URL preserved'},navigation:'accepted launch requests; native visibility checked separately',voice:'main returned Deepgram; native Audio playing/ended without errors and waveform overlap; human hearing not asserted',securityVoiceEvidence},null,2));
 console.log('PASS: actual Codex-generated changes and completion notifications; live Sonnet security, correctness, API and clean reviews; real clipboard/navigation requests, Deepgram playback state and Codex fix/re-review loops. Sanitized timings: artifacts/live-scenarios.json');
}catch(error){
 const voice=await voiceEvidence(app,qaPage).catch(()=>undefined);
 await writeFile('artifacts/live-scenarios.json',JSON.stringify({result:'FAIL',fixtureRoot:root,metrics,voice,error:error instanceof Error?error.message:'Scenario failed'},null,2));
 throw error;
}finally{
 await app.close();if(completed)await rm(root,{recursive:true,force:true});
}
