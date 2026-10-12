import {useCallback,useEffect,useRef,useState} from 'react';
import type {AppState} from '../shared/types';
export function useSpeech(state:AppState|undefined){
 const [speaking,setSpeaking]=useState(false),[levels,setLevels]=useState([3,3,3,3,3]),[status,setStatus]=useState('');
 const generation=useRef(0),cleanup=useRef<()=>void>(()=>{}),announced=useRef<string|undefined>(undefined);
 const stop=useCallback(()=>{generation.current++;cleanup.current();cleanup.current=()=>{};window.speechSynthesis?.cancel();setSpeaking(false);setLevels([3,3,3,3,3]);setStatus('');void window.softfex.stopSpeech();},[]);
 const speak=useCallback(async(request:{kind:'test'}|{kind:'report';reviewId:string})=>{
  stop();const current=generation.current;setStatus('Preparing voice…');
  const result=await window.softfex.requestSpeech(request).catch(()=>undefined);
  if(current!==generation.current)return;
  if(!result?.ok){setStatus(result?.error||'Voice unavailable. Findings remain visible.');return;}
  const response=result.value;let fallbackStarted=false;
  function fallback(){
   if(current!==generation.current||fallbackStarted)return;fallbackStarted=true;
   if(!window.speechSynthesis){setStatus('System voice unavailable. Findings remain visible.');return;}
   const utterance=new SpeechSynthesisUtterance(response.text);utterance.rate=1.05;utterance.lang='en-US';
   let started=false;let ended=false;
   const timeout=setTimeout(()=>{if(!started&&!ended&&current===generation.current){window.speechSynthesis.cancel();setSpeaking(false);setStatus('Voice needs activation or is unavailable. Use Test voice.');}},4000);
   utterance.onstart=()=>{started=true;if(current===generation.current){setSpeaking(true);setLevels([6,13,18,11,5]);setStatus(response.notice||'Speaking · system voice');}};
   utterance.onend=()=>{ended=true;clearTimeout(timeout);if(current===generation.current){setSpeaking(false);setLevels([3,3,3,3,3]);setStatus('System voice playback completed');}};
   utterance.onerror=()=>{ended=true;clearTimeout(timeout);if(current===generation.current){setSpeaking(false);setStatus('Voice unavailable. Use Test voice; findings remain visible.');}};
   cleanup.current=()=>{ended=true;clearTimeout(timeout);window.speechSynthesis.cancel();};
   window.speechSynthesis.speak(utterance);
  }
  if(response.provider==='browser'||!response.bytes){fallback();return;}
  const bytes=new Uint8Array(response.bytes);const url=URL.createObjectURL(new Blob([bytes.buffer],{type:'audio/mpeg'}));const audio=new Audio(url);
  let context:AudioContext|undefined;let frame=0;let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;audio.onplaying=null;audio.onpause=null;audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');cancelAnimationFrame(frame);URL.revokeObjectURL(url);void context?.close().catch(()=>{});};
  cleanup.current=dispose;
  audio.onplaying=()=>{
   if(current!==generation.current){dispose();return;}
   setSpeaking(true);setStatus('Speaking · Deepgram Aura 2');
   try{
    if(context)return;context=new AudioContext();const source=context.createMediaElementSource(audio);const analyser=context.createAnalyser();analyser.fftSize=64;source.connect(analyser);analyser.connect(context.destination);void context.resume().catch(()=>{});
    const data=new Uint8Array(analyser.frequencyBinCount);
    const tick=()=>{if(current!==generation.current)return;analyser.getByteFrequencyData(data);setLevels([1,3,6,9,13].map(i=>3+Math.round(data[i]/255*16)));frame=requestAnimationFrame(tick);};tick();
   }catch{setLevels([5,9,13,9,5]);}
  };
  audio.onpause=()=>{if(current===generation.current)setSpeaking(false);};
  audio.onended=()=>{if(current===generation.current){setSpeaking(false);setLevels([3,3,3,3,3]);setStatus('Deepgram Aura 2 playback completed');}dispose();};
  audio.onerror=()=>{dispose();if(current===generation.current){setSpeaking(false);setStatus('Audio playback failed · trying system voice');fallback();}};
  try{await audio.play();}catch{dispose();if(current===generation.current){setSpeaking(false);setStatus('Audio needs activation · trying system voice');fallback();}}
 },[stop]);
 useEffect(()=>{
  if(state?.muted||state?.phase==='reviewing'||state?.phase==='report_outdated'){stop();return;}
  const report=state?.report;
  if(!report||report.reviewId===announced.current||report.status==='outdated'||report.status==='failed')return;
  announced.current=report.reviewId;
  if(report.findings.some(f=>f.severity==='high'||f.severity==='critical'))void speak({kind:'report',reviewId:report.reviewId});
 },[state?.report?.reviewId,state?.report?.status,state?.phase,state?.muted,speak,stop]);
 useEffect(()=>()=>{generation.current++;cleanup.current();window.speechSynthesis?.cancel();void window.softfex.stopSpeech();},[]);
 return {speaking,levels,status,testVoice:()=>speak({kind:'test'}),stop};
}
