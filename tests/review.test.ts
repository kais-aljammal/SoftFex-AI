import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkspaceWatcher} from '../src/main/watcher';import {ReviewCoordinator} from '../src/main/review';import type {AppState} from '../src/shared/types';
const unsafe='db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',safe='db.query("SELECT * FROM users WHERE id = ?", [req.params.id]);';
async function until(predicate:()=>boolean){for(let i=0;i<120;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Condition timed out');}
const initial=():AppState=>({phase:'watching',changedFiles:0,revision:0,muted:false,aiEnabled:false,apiKeyPresent:false,apiConnectivity:'unchecked',integration:'manual'});
const ok=()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"findings":[]}'}]});
test('completion before the watcher event reconciles actual source and duplicate completions do not review twice',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-early-completion-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),safe);watcher=await WorkspaceWatcher.create(root,()=>{});
  // Hold back native events deterministically; completion must discover the disk write itself.
  t.mock.method(watcher,'onFile',async()=>{});
  await writeFile(join(root,'auth.ts'),unsafe);assert.equal(watcher.pending.size,0);
  const state=initial();let reports=0;let lastId:string|undefined;
  reviewer=new ReviewCoordinator(watcher,state,()=>{if(state.report&&state.report.reviewId!==lastId){lastId=state.report.reviewId;reports++;}},()=>undefined);
  await Promise.all([reviewer.request('codex_turn_complete'),reviewer.request('codex_turn_complete')]);
  await until(()=>!reviewer!.active);
  assert.equal(state.report?.trigger,'codex_turn_complete');assert.equal(state.report?.mode,'changed');
  assert.equal(state.report?.findings.length,1);assert.equal(reports,1);assert.equal(watcher.pending.size,0);
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('manual re-review reuses bounded sanitized task context only with consent and a new workspace clears it',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-task-memory-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),safe);watcher=await WorkspaceWatcher.create(root,()=>{});
  const state=initial();const tasks:(string|undefined)[]=[];
  t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{const body=JSON.parse(String(options?.body));tasks.push(JSON.parse(body.messages[0].content).taskContext);return ok();});
  reviewer=new ReviewCoordinator(watcher,state,()=>{},()=> 'synthetic-key',text=>text.replaceAll('private-token','[REDACTED]'));
  await reviewer.request('codex_turn_complete','Supporting private-token '+ 'x'.repeat(2000));
  await reviewer.request('manual');assert.equal(tasks.length,0,'No consent means no provider calls.');
  state.aiEnabled=true;await reviewer.request('manual');
  assert.ok(tasks[0]?.startsWith('Supporting [REDACTED]'));assert.ok(tasks[0]!.length<=1600);assert.ok(!tasks[0]?.includes('private-token'));
  reviewer.close();reviewer=new ReviewCoordinator(watcher,state,()=>{},()=> 'synthetic-key');
  await reviewer.request('manual');assert.equal(tasks[1],undefined);
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('closing during completion settling cancels without publishing a review',async()=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-settle-cancel-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),safe);watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();
  reviewer=new ReviewCoordinator(watcher,state,()=>{},()=>undefined);
  const request=reviewer.request('codex_turn_complete');reviewer.close();await request;
  assert.equal(state.report,undefined);assert.equal(reviewer.active,false);
  await assert.rejects(watcher.listFiles(undefined,Date.now()-1),/reconciliation timed out/);
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('failed AI re-review preserves prior uncertainty and does not checkpoint corrected source',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-failure-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),unsafe);watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();reviewer=new ReviewCoordinator(watcher,state,()=>{},()=> 'synthetic-key');
  await reviewer.request('manual');assert.equal(state.report?.findings.length,1);
  await writeFile(join(root,'auth.ts'),safe);await until(()=>watcher!.pending.size===1);state.aiEnabled=true;
  t.mock.method(globalThis,'fetch',async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'invalid json'}]}));
  await reviewer.request('manual');assert.equal(state.report?.status,'partial');assert.equal(state.report?.aiStatus,'failed');assert.equal(watcher.pending.size,1);
  assert.equal(state.report?.previousFindings[0].status,'not_reverified');
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('edits during AI review invalidate its snapshot; repeated triggers coalesce to one queued review',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-inflight-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),unsafe);watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();state.aiEnabled=true;
  const statuses:string[]=[];reviewer=new ReviewCoordinator(watcher,state,()=>{if(state.report)statuses.push(state.report.status);},()=> 'synthetic-key');
  let requests=0;let release:()=>void=()=>{};const blocked=new Promise<void>(r=>release=r);
  t.mock.method(globalThis,'fetch',async()=>{requests++;if(requests===1)await blocked;return ok();});
  const active=reviewer.request('manual');await until(()=>requests===1);
  for(let i=0;i<5;i++)await reviewer.request('manual');await writeFile(join(root,'auth.ts'),safe);await until(()=>watcher!.pending.size===1);release();await active;
  await until(()=>!reviewer!.active);assert.equal(requests,2);assert.ok(statuses.includes('outdated'));assert.equal(state.report?.status,'complete');assert.equal(state.report?.findings.length,0);assert.equal(watcher.pending.size,0);
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('changes to supporting context invalidate a review without resolving its related scope',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-context-inflight-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'client.ts'),'import { value } from "./contract";\nexport const result = value;');
  await writeFile(join(root,'contract.ts'),'export const value = 1;');
  watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();state.aiEnabled=true;
  reviewer=new ReviewCoordinator(watcher,state,()=>{},()=> 'synthetic-key');
  await writeFile(join(root,'client.ts'),'import { value } from "./contract";\nexport const result = value + 1;');await until(()=>watcher!.pending.has('client.ts'));
  let release:()=>void=()=>{};const blocked=new Promise<void>(r=>release=r);let requested=false;
  t.mock.method(globalThis,'fetch',async()=>{requested=true;await blocked;return ok();});
  const review=reviewer.request('manual');await until(()=>requested);
  await writeFile(join(root,'contract.ts'),'export const value = 2;');release();await review;
  assert.equal(state.report?.status,'outdated');assert.deepEqual(state.report?.reviewedFiles,['client.ts']);assert.ok(!state.report?.reviewedFiles.includes('contract.ts'));
  assert.equal(watcher.pending.has('client.ts'),true);
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('content changed during checkpoint is outdated before the watcher event arrives',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-checkpoint-race-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),unsafe);watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();
  reviewer=new ReviewCoordinator(watcher,state,()=>{},()=>undefined);
  const checkpoint=watcher.checkpoint.bind(watcher);
  t.mock.method(watcher,'checkpoint',async(files:Parameters<WorkspaceWatcher['checkpoint']>[0])=>{await writeFile(join(root,'auth.ts'),safe);await checkpoint(files);});
  await reviewer.request('manual');assert.equal(state.report?.status,'outdated');assert.equal(state.phase,'report_outdated');
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('context gathering failure keeps deterministic findings available and never checkpoints',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-context-failure-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 try{
  await writeFile(join(root,'auth.ts'),'export const valid = true;');watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();state.aiEnabled=true;
  await writeFile(join(root,'auth.ts'),unsafe);await until(()=>watcher!.pending.has('auth.ts'));
  reviewer=new ReviewCoordinator(watcher,state,()=>{},()=> 'synthetic-key');
  t.mock.method(watcher,'listFiles',async()=>{throw new Error('private filesystem detail');});
  await reviewer.request('manual');assert.equal(state.report?.status,'partial');assert.equal(state.report?.findings.length,1);assert.equal(state.report?.aiStatus,'failed');
  assert.equal(watcher.pending.has('auth.ts'),true);assert.ok(!state.report?.note?.includes('private filesystem detail'));
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('an unrelated nearby source edit does not resolve an unchanged AI defect, but its actual correction does',async t=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-ai-lifecycle-'));let watcher:WorkspaceWatcher|undefined;let reviewer:ReviewCoordinator|undefined;
 const original='export function mean(values: number[]) {\n  const total = values.reduce((sum, n) => sum + n, 0);\n  return total / (values.length - 1);\n}\n// Original comment.';
 try{
  await writeFile(join(root,'mean.ts'),original);watcher=await WorkspaceWatcher.create(root,()=>{});const state=initial();state.aiEnabled=true;
  reviewer=new ReviewCoordinator(watcher,state,()=>{},()=> 'synthetic-key');let requests=0;
  const candidate={severity:'medium',confidence:'high',category:'correctness',title:'Incorrect mean denominator',file:'mean.ts',startLine:3,endLine:3,evidence:'return total / (values.length - 1);',explanation:'The mean divides by one fewer element than the collection contains.',impact:'For values [2, 4] this returns 6 instead of 3.',recommendation:'Divide by values.length and define empty-input behavior.'};
  t.mock.method(globalThis,'fetch',async()=>{requests++;return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({findings:requests===1?[candidate]:[]})}]});});
  await reviewer.request('manual');assert.equal(state.report?.findings.length,1);
  const commentEdit=original.replace('Original comment','Unrelated comment changed');await writeFile(join(root,'mean.ts'),commentEdit);await until(()=>watcher!.pending.has('mean.ts'));
  await reviewer.request('manual');assert.equal(state.report?.aiStatus,'completed');assert.equal(state.report?.previousFindings[0].status,'not_reverified');
  await writeFile(join(root,'mean.ts'),commentEdit.replace('values.length - 1','values.length'));await until(()=>watcher!.pending.has('mean.ts'));
  await reviewer.request('manual');assert.equal(state.report?.aiStatus,'completed');assert.equal(state.report?.previousFindings[0].status,'resolved_in_latest_snapshot');assert.equal(requests,3);
 }finally{reviewer?.close();await watcher?.close();await rm(root,{recursive:true,force:true});}
});
