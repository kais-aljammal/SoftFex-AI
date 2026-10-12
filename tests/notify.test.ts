import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('real notification relay forwards only bounded completion metadata and validated task shape',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'softfex-notify-'));const bodies:Record<string,unknown>[]=[];
 const server=createServer((request,response)=>{const chunks:Buffer[]=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));response.writeHead(204);response.end();});});
 await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const descriptor=join(directory,'bridge.json');await writeFile(descriptor,JSON.stringify({host:'127.0.0.1',port:address.port,token:'a'.repeat(64)}));
 const run=(event:unknown)=>new Promise<void>((yes,no)=>{
  const child=spawn(process.execPath,[resolve('scripts/softfex-notify.cjs'),JSON.stringify(event)],{env:{...process.env,SOFTFEX_BRIDGE_DESCRIPTOR:descriptor},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>{child.kill();no(new Error('Relay blocked the coding agent.'));},2000);
  child.once('error',error=>{clearTimeout(timer);no(error);});child.once('exit',code=>{clearTimeout(timer);try{assert.equal(code,0);assert.equal(stdout,'');assert.equal(stderr,'');yes();}catch(error){no(error);}});
 });
 try{
  const completion={type:'agent-turn-complete',cwd:directory,'thread-id':'thread','turn-id':'turn'};
  await run({...completion,'input-messages':['earlier task','x'.repeat(2000)],'last-assistant-message':'DO NOT FORWARD',unexpected:'DO NOT FORWARD'});
  assert.equal(bodies.length,1);assert.equal(bodies[0].taskContext,'x'.repeat(1600));assert.deepEqual(Object.keys(bodies[0]).sort(),['cwd','taskContext','thread-id','turn-id','type'].sort());
  await run({...completion,'input-messages':[{role:'user',content:'unsupported shape'}]});assert.equal(bodies.length,2);assert.equal(bodies[1].taskContext,undefined);
  await run({...completion,type:'unrelated-event'});assert.equal(bodies.length,2);
  await writeFile(descriptor,JSON.stringify({host:'external.invalid',port:address.port,token:'a'.repeat(64)}));await run(completion);assert.equal(bodies.length,2,'Relay must never connect to an arbitrary descriptor host.');
 }finally{await new Promise<void>(yes=>server.close(()=>yes()));await rm(directory,{recursive:true,force:true});}
});
