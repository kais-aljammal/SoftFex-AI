import {test} from 'node:test';import assert from 'node:assert/strict';
import {reviewAI,redactSource} from '../src/main/llm';import {generateSpeech} from '../src/main/speech';import {source} from './helpers';
test('credential redaction covers JSON quoted properties and source assignments',()=>{
 for(const text of ['{"apiKey":"synthetic-private-value"}','const password = "synthetic-private-value"','{"DEEPGRAM_API_KEY":"synthetic-private-value"}']){assert.ok(!redactSource(text).includes('synthetic-private-value'));assert.ok(redactSource(text).includes('[REDACTED]'));}
});
const response=(text:string,stop='end_turn')=>Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',stop_reason:stop,content:[{type:'text',text}],usage:{input_tokens:1,output_tokens:1}});
test('AI malformed JSON, refusal and fabricated evidence fail without fabricated findings',async t=>{
 for(const [body,stop] of [['not json','end_turn'],['{"findings":[]}','refusal'],['{"findings":[]}','max_tokens'],['{"findings":[{"file":"invented.ts"}]}','end_turn']]){
  const mock=t.mock.method(globalThis,'fetch',async()=>response(body,stop));
  const result=await reviewAI('synthetic-key',[source('export const n = 1;')],[],new AbortController().signal);
  assert.equal(result.ok,false);assert.equal(result.findings.length,0);mock.mock.restore();
 }
});
test('AI request grounds engineering playbooks, excludes credentials and rejects context-only findings',async t=>{
 const changed={...source('import { contract } from "./contract";\nexport const value = contract.value;'),file:'src/client.ts'};
 const context={...source('export const contract = { value: 1 };'),file:'src/contract.ts',relatedTo:[changed.file],relation:'dependency' as const,truncated:false};
 const candidate={severity:'medium',confidence:'high',category:'correctness',title:'Context-only claim',file:context.file,startLine:1,endLine:1,evidence:context.content,explanation:'Specific explanation',impact:'Specific impact',recommendation:'Specific correction'};
 let requestBody:Record<string,unknown>={};
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{requestBody=JSON.parse(String(options?.body));return response(JSON.stringify({findings:[candidate]}));});
 const result=await reviewAI('synthetic-key',[changed],[],new AbortController().signal,{relatedFiles:[context],taskContext:'Implement value; apiKey="synthetic-private-value".'});
 assert.equal(requestBody.model,'claude-sonnet-5-5');assert.equal(result.ok,false);assert.equal(result.findings.length,0);
 const payload=JSON.parse((requestBody.messages as {content:string}[])[0].content);
 assert.equal(payload.reviewPlaybooks[0].discipline,'correctness');assert.equal(payload.relatedContext[0].file,context.file);
 assert.ok(!JSON.stringify(payload).includes('synthetic-private-value'));assert.ok(String(requestBody.system).includes('untrusted data'));
});
test('review policy requires contract-grounded observable impact and distinguishes rejection from optional diagnostics',async t=>{
 let policy='';
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{policy=JSON.parse(String(options?.body)).system;return response('{"findings":[]}');});
 const result=await reviewAI('synthetic-key',[source('export const n = 1;')],[],new AbortController().signal);
 assert.equal(result.ok,true);
 assert.match(policy,/reachable input allowed by the supplied contract/);
 assert.match(policy,/observable incorrect result or broken caller requirement/);
 assert.match(policy,/Do not invent excluded inputs, response shapes or caller needs/);
 assert.match(policy,/may be contradicted by supplied source/);
 assert.match(policy,/missing status\/message detail needs a concrete supplied caller or contract that requires it/);
 assert.match(policy,/Distinguish failure to reject from optional error formatting/);
 assert.match(policy,/Omit a finding if the supplied behavior already satisfies the relevant contract/);
 assert.match(policy,/Version-dependent language, compiler or library compatibility claims require a supplied version\/configuration and concrete demonstrable incompatibility/);
 assert.match(policy,/An unknown version or a claim that code may not compile alone is insufficient evidence/);
});
test('changed contracts outside the current batch are bounded supporting context, then reviewed in their own batch',async t=>{
 const files=[{...source('import { value } from "./contract";\nexport const result = value;'),file:'src/client.ts'},
  {...source('export const one = 1;'),file:'src/one.ts'}, {...source('export const two = 2;'),file:'src/two.ts'},
  {...source('export const value = 3;'),file:'src/contract.ts'}];
 const payloads:{reviewedFiles:{file:string}[];relatedContext:{file:string}[]}[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{const body=JSON.parse(String(options?.body));payloads.push(JSON.parse(body.messages[0].content));return response('{"findings":[]}');});
 const result=await reviewAI('synthetic-key',files,[],new AbortController().signal);
 assert.equal(result.ok,true);assert.equal(payloads.length,2);
 assert.ok(payloads[0].relatedContext.some(file=>file.file==='src/contract.ts'));
 assert.ok(!payloads[0].reviewedFiles.some(file=>file.file==='src/contract.ts'));
 assert.equal(payloads[1].reviewedFiles[0].file,'src/contract.ts');
 assert.ok(payloads[1].relatedContext.some(file=>file.file==='src/client.ts'));
});
test('main exact-key sanitizer masks neutral source literals across all AI payload text without mutating evidence',async t=>{
 const privateValue='b'.repeat(64);
 const raw=`export const neutral = "${privateValue}";\nexport const apiKey = "synthetic-pattern-value";`;
 const changed={...source(raw),file:'src/client.ts'};
 const context={...source(`export const other = "${privateValue}";`),file:'src/contract.ts',relatedTo:[changed.file],relation:'dependency' as const,truncated:false};
 const local={file:changed.file,startLine:1,title:`Literal ${privateValue}`} as Parameters<typeof reviewAI>[2][number];
 let requestBody='';
 t.mock.method(globalThis,'fetch',async(_url:unknown,options?:RequestInit)=>{requestBody=String(options?.body);return response('{"findings":[]}');});
 const sanitize=(text:string)=>text.replaceAll(privateValue,'[REDACTED]');
 const result=await reviewAI('synthetic-key',[changed],[local],new AbortController().signal,{relatedFiles:[context],taskContext:`Implement neutral ${privateValue}`,sanitize});
 assert.equal(result.ok,true);assert.ok(!requestBody.includes(privateValue));assert.ok(!requestBody.includes('synthetic-pattern-value'));
 const payload=JSON.parse(JSON.parse(requestBody).messages[0].content);
 assert.ok(payload.reviewedFiles[0].numberedSource.includes('[REDACTED]'));assert.ok(payload.relatedContext[0].numberedSource.includes('[REDACTED]'));
 assert.ok(payload.taskContext.includes('[REDACTED]'));assert.ok(payload.localFindings[0].title.includes('[REDACTED]'));
 assert.equal(changed.content,raw);assert.ok(changed.context.includes(privateValue));assert.ok(context.content.includes(privateValue));assert.ok(local.title.includes(privateValue));
});
test('AI rate limit retries once; authentication errors are sanitized',async t=>{
 let requests=0;const mock=t.mock.method(globalThis,'fetch',async()=>{requests++;return requests===1?Response.json({error:{type:'rate_limit_error',message:'private provider detail'}},{status:429}):response('{"findings":[]}');});
 const result=await reviewAI('synthetic-key',[source('export const n=1;')],[],new AbortController().signal);
 assert.equal(result.ok,true);assert.equal(requests,2);mock.mock.restore();
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:{type:'authentication_error',message:'private provider detail'}},{status:401}));
 const failed=await reviewAI('synthetic-key',[source('const n=1;')],[],new AbortController().signal);
 assert.equal(failed.ok,false);assert.ok(failed.note?.includes('authentication'));assert.ok(!failed.note?.includes('private provider detail'));
});
test('AI cancellation returns a degraded result without retrying',async t=>{
 const controller=new AbortController();controller.abort();let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new DOMException('Aborted','AbortError');});
 const result=await reviewAI('synthetic-key',[source('const n=1;')],[],controller.signal);
 assert.equal(result.ok,false);assert.ok(calls<=1);
});
test('Deepgram failure, invalid audio, oversized audio and cancellation select browser fallback',async t=>{
 for(const make of [()=>Response.json({error:'private detail'},{status:429}),()=>Response.json({invalid:true}),()=>new Response(new Uint8Array(1_000_001),{headers:{'content-type':'audio/mpeg'}}),()=>{throw new DOMException('Aborted','AbortError');}]){
  const mock=t.mock.method(globalThis,'fetch',async()=>make());const result=await generateSpeech('synthetic-key','Short qualified warning',new AbortController().signal);
  assert.equal(result.provider,'browser');assert.ok(!result.notice?.includes('private detail'));mock.mock.restore();
 }
});
