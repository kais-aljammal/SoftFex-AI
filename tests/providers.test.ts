import {test} from 'node:test';import assert from 'node:assert/strict';
import {reviewAI} from '../src/main/llm';import {generateSpeech} from '../src/main/speech';import {source} from './helpers';
const response=(text:string,stop='end_turn')=>Response.json({id:'synthetic',type:'message',role:'assistant',model:'claude-sonnet-5-5',stop_reason:stop,content:[{type:'text',text}],usage:{input_tokens:1,output_tokens:1}});
test('AI malformed JSON, refusal and fabricated evidence fail without fabricated findings',async t=>{
 for(const [body,stop] of [['not json','end_turn'],['{"findings":[]}','refusal'],['{"findings":[{"file":"invented.ts"}]}','end_turn']]){
  const mock=t.mock.method(globalThis,'fetch',async()=>response(body,stop));
  const result=await reviewAI('synthetic-key',[source('export const n = 1;')],[],new AbortController().signal);
  assert.equal(result.ok,false);assert.equal(result.findings.length,0);mock.mock.restore();
 }
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
