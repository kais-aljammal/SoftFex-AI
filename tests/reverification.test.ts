import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkspaceWatcher,LIMITS} from '../src/main/watcher';import {captureSnapshot} from '../src/main/snapshot';
import {validateReverifications,previousStatuses} from '../src/main/findings';import {reviewAI} from '../src/main/llm';
import type {Finding,ReviewReport} from '../src/shared/types';import {source} from './helpers';
const old={id:'mean-old',origin:'ai',category:'correctness',severity:'high',confidence:'high',file:'src/auth.ts',startLine:2,endLine:2,evidence:'return sum / (values.length - 1);',title:'Wrong mean divisor',explanation:'Divides by one fewer value.',impact:'[2,4] returns 6.',recommendation:'Divide by the element count.',snapshotHash:'old-hash'} as Finding;
const fixed={...source('export function mean(sum: number, values: number[]) {\n  return sum / values.length;\n}'),reverificationIds:[old.id]};
const verdict={findingId:old.id,status:'no_longer_detected' as const,startLine:2,endLine:2,evidence:'return sum / values.length;',explanation:'The replacement divisor is the number of input values.'};
const history={findings:[old],previousFindings:[]} as unknown as ReviewReport;
test('resolution requires full corrected scope, validated explicit assessment and successful AI review',()=>{
 const validated=validateReverifications({reverification:[verdict]},[fixed],[old]);assert.equal(validated.rejected,0);
 assert.equal(previousStatuses(history,[],[fixed],true,validated.assessments)[0].status,'resolved_in_latest_snapshot');
 for(const [files,success,assessments,reason] of [
  [[fixed],true,[],/no explicit assessment/],
  [[{...fixed,reverificationIds:[]}],true,[verdict],/bounded review coverage/],
  [[{...fixed,coveredLines:new Set([2])}],true,[verdict],/bounded review coverage/],
  [[fixed],false,[verdict],/AI review did not complete/],
  [[],true,[verdict],/Affected file was not covered/],
 ] as const){const result=previousStatuses(history,[],[...files],success,[...assessments])[0];assert.equal(result.status,'not_reverified');assert.match(result.reason??'',reason);}
});
test('fabricated, duplicate, context-only and unrequested assessments cannot establish resolution',()=>{
 for(const [raw,files,prior] of [
  [{reverification:[{...verdict,evidence:'invented corrected code'}]},[fixed],[old]],
  [{reverification:[{...verdict,endLine:500}]},[fixed],[old]],
  [{reverification:[verdict,verdict]},[fixed],[old]],
  [{reverification:[verdict]},[{...fixed,reverificationIds:[]}],[old]],
  [{reverification:[verdict]},[fixed],[]],
  [{reverification:[verdict]},[{...fixed,coveredLines:new Set([2])}],[old]],
 ] as const){const result=validateReverifications(raw,[...files],[...prior]);assert.ok(result.rejected>0);assert.equal(result.assessments.length,0);}
});
test('snapshot supplies the affected function in full after the old evidence disappears, within existing limits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-scope-'));let watcher:WorkspaceWatcher|undefined;
 try{
  const padding=Array.from({length:45},(_,i)=>`// padding ${i}`).join('\n');
  const before='export function mean(values: number[]) {\n'+padding+'\n return values.reduce((s,n)=>s+n,0) / (values.length - 1);\n}';
  await writeFile(join(root,'mean.ts'),before);watcher=await WorkspaceWatcher.create(root,()=>{});
  const after=before.replace('(values.length - 1)','values.length');await writeFile(join(root,'mean.ts'),after);await watcher.onFile(join(root,'mean.ts'));
  const snapshot=await captureSnapshot(watcher,undefined,[{...old,file:'mean.ts'}]);const file=snapshot.files[0];
  assert.equal(file.coveredLines.size,after.split('\n').length);assert.deepEqual(file.reverificationIds,[old.id]);assert.ok(file.context.includes('export function mean'));assert.ok(file.context.includes('/ values.length;'));assert.ok(file.context.length<=LIMITS.maxTotalContextChars);
 }finally{await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('validated still-present assessments keep an unchanged remaining issue active with current evidence',async t=>{
 const file={...source(old.evidence),reverificationIds:[old.id]};let payload='';
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{payload=String(options?.body);return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({findings:[],reverification:[{...verdict,status:'still_detected',startLine:1,endLine:1,evidence:old.evidence,explanation:'The off-by-one divisor still produces 6 for sum 6 and two values.'}]})}]});});
 const result=await reviewAI('synthetic-key',[file],[],new AbortController().signal,{previousFindings:[old]});
 assert.equal(result.ok,true);assert.equal(result.findings.length,1);assert.equal(result.findings[0].evidence,old.evidence);assert.equal(result.findings[0].snapshotHash,file.hash);assert.ok(payload.includes('priorIssues'));
});
test('an inserted guard can correct a prior issue whose old return expression is unchanged',()=>{
 const content='export async function load(response: Response) {\n  if (!response.ok) throw new Error("Request failed");\n  return response.json();\n}';
 const prior={...old,evidence:'return response.json();',startLine:2,endLine:2};
 const file={...source(content),changedStart:2,changedEnd:2,reverificationIds:[prior.id]};
 const history={findings:[prior],previousFindings:[]} as unknown as ReviewReport;
 const good=validateReverifications({reverification:[{...verdict,startLine:1,endLine:4,evidence:'if (!response.ok) throw new Error("Request failed");'}]},[file],[prior]);
 assert.equal(good.assessments[0].startLine,2);assert.equal(previousStatuses(history,[],[file],true,good.assessments)[0].status,'resolved_in_latest_snapshot');
 const broad=validateReverifications({reverification:[{...verdict,startLine:1,endLine:4,evidence:'return response.json();'}]},[file],[prior]);
 assert.equal(broad.assessments[0].startLine,3);const result=previousStatuses(history,[],[file],true,broad.assessments)[0];assert.equal(result.status,'not_reverified');assert.match(result.reason??'',/outside the edited scope/);
});
