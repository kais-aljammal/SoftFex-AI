import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkspaceWatcher} from '../src/main/watcher';import {ReviewCoordinator} from '../src/main/review';import type {AppState} from '../src/shared/types';
const unsafe='db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',safe='db.query("SELECT * FROM users WHERE id = ?", [req.params.id]);';
async function until(predicate:()=>boolean){for(let i=0;i<120;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Condition timed out');}
const initial=():AppState=>({phase:'watching',changedFiles:0,revision:0,muted:false,aiEnabled:false,apiKeyPresent:false,apiConnectivity:'unchecked',integration:'manual'});
const ok=()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text:'{"findings":[]}'}]});
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
