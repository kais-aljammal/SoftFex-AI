import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
// Failure injection, not a live-provider or human-audibility test.
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',()=>errors.push('renderer error'));
 await app.evaluate(()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async function(input,options){if(String(input).startsWith('https://api.deepgram.com/v1/speak'))return new Response(new Uint8Array(64),{headers:{'content-type':'audio/mpeg'}});return original.call(this,input,options);};
 });
 await page.evaluate(()=>{
  window.__qaUtterances=0;
  window.Audio=class{
   pause(){}removeAttribute(){}
   play(){this.onerror?.(new Event('error'));return Promise.reject(new Error('Synthetic decoder rejection'));}
  };
  window.speechSynthesis.cancel=()=>{};
  window.speechSynthesis.speak=utterance=>{window.__qaUtterances++;setTimeout(()=>utterance.onstart?.(new Event('start')),10);setTimeout(()=>utterance.onend?.(new Event('end')),400);};
 });
 await page.getByRole('button',{name:/Open SoftFex/}).click();await page.getByRole('button',{name:'Test voice',exact:true}).click();
 await page.getByLabel('Voice playback active',{exact:true}).waitFor();
 await page.locator('.voice-status').filter({hasText:'Speaking'}).waitFor();
 await page.locator('.voice-status').filter({hasText:/System voice played|System voice playback completed/}).waitFor();
 assert.equal(await page.evaluate(()=>window.__qaUtterances),1,'Decoder error + rejected play() must produce only one fallback utterance.');
 assert.equal(await page.getByLabel('Voice playback active',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Test voice',exact:true}).click();await page.getByLabel('Voice playback active',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Mute',exact:true}).click();await page.getByRole('button',{name:'Unmute',exact:true}).waitFor();
 await page.getByLabel('Voice playback active',{exact:true}).waitFor({state:'hidden'});await page.locator('.voice-status').waitFor({state:'hidden'});
 assert.equal(await page.getByLabel('Voice playback active',{exact:true}).count(),0);assert.equal(await page.locator('.voice-status').count(),0,'Canceled speech must not retain a misleading Speaking label.');assert.deepEqual(errors,[]);
 assert.equal(await page.getByRole('button',{name:'Choose project folder',exact:true}).isEnabled(),true);
 console.log('PASS: synthetic corrupt audio triggers decoder error and play rejection, but exactly one browser fallback; truthful playing state, cleanup and usable UI remain intact.');
}finally{await app.close();}
