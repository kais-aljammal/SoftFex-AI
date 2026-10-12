// Test-only observation at actual playback/IPC boundaries. Never records speech
// text, audio data, source, authentication headers or credentials.
export async function observeVoice(app,page){
 await app.evaluate(({ipcMain,BrowserWindow})=>{
  globalThis.__qaVoiceTrace=[];
  const remember=entry=>{globalThis.__qaVoiceTrace.push({at:Date.now(),...entry});if(globalThis.__qaVoiceTrace.length>100)globalThis.__qaVoiceTrace.shift();};
  for(const name of ['softfex:requestSpeech','softfex:stopSpeech']){
   const original=ipcMain._invokeHandlers.get(name);
   ipcMain._invokeHandlers.set(name,async function(event,...args){
    const kind=args[0]?.kind;
    remember({event:name,kind});const result=await original.call(this,event,...args);
    remember({event:name+' result',kind,ok:result?.ok,provider:result?.value?.provider});return result;
   });
  }
  const contents=BrowserWindow.getAllWindows()[0].webContents,originalSend=contents.send;
  contents.send=function(channel,...args){if(channel==='softfex:state')remember({event:'state',phase:args[0]?.phase,reportStatus:args[0]?.report?.status});return originalSend.call(this,channel,...args);};
 });
 await page.evaluate(()=>{
  window.__qaVoice=[];window.__qaAudioEvents=[];window.__qaAudioPlaying=false;window.__qaWaveformOverlap=undefined;
  const playing=new Set();let audioId=0;
  const islandState=()=>document.querySelector('.island-notification')?'warning':document.querySelector('.notch')?'expanded':document.querySelector('.pill')?'compact':'unmounted';
  const observe=()=>{const status=document.querySelector('.voice-status'),sample={at:Date.now(),active:!!document.querySelector('[aria-label="Voice playback active"]'),audioPlaying:window.__qaAudioPlaying,islandState:islandState(),provider:status?.getAttribute('title')||status?.textContent||''};if(sample.active&&sample.audioPlaying)window.__qaWaveformOverlap=sample;window.__qaVoice.push(sample);if(window.__qaVoice.length>100)window.__qaVoice.splice(0,window.__qaVoice.length-100);};
  const OriginalAudio=window.Audio;
  window.Audio=function(...args){const audio=new OriginalAudio(...args),id=++audioId;for(const name of ['playing','pause','ended','error'])audio.addEventListener(name,()=>{if(name==='playing')playing.add(audio);else playing.delete(audio);window.__qaAudioPlaying=playing.size>0;window.__qaAudioEvents.push({at:Date.now(),id,event:name,audioPlaying:window.__qaAudioPlaying});observe();});return audio;};window.Audio.prototype=OriginalAudio.prototype;
  window.__qaVoiceObserver=new MutationObserver(observe);window.__qaVoiceObserver.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});
 });
}
export async function voiceEvidence(app,page){
 return {main:await app.evaluate(()=>globalThis.__qaVoiceTrace),renderer:await page.evaluate(()=>({observations:window.__qaVoice?.slice(-20),waveformOverlap:window.__qaWaveformOverlap,audioEvents:window.__qaAudioEvents,audioPlaying:window.__qaAudioPlaying,islandState:document.querySelector('.island-notification')?'warning':document.querySelector('.notch')?'expanded':document.querySelector('.pill')?'compact':'unmounted',status:document.querySelector('.voice-status')?.getAttribute('title')}))};
}
