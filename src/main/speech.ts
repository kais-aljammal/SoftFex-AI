import type {ReviewReport,SpeechResult} from '../shared/types';
export function speechSummary(report:ReviewReport){
 if(report.status==='outdated'||report.status==='failed')return undefined;
 const important=report.findings.filter(f=>f.severity==='high'||f.severity==='critical');
 if(!important.length)return undefined;
 const severity=important.some(f=>f.severity==='critical')?'critical':'high';
 return `SoftFex found ${important.length===1?'one':important.length} potential ${severity} severity ${important.length===1?'issue':'issues'} in reviewed changes. Open the island to inspect the evidence.`;
}
export async function generateSpeech(key:string|undefined,text:string,signal:AbortSignal):Promise<SpeechResult>{
 if(!key)return {provider:'browser',text,notice:'Deepgram key not configured · using system voice'};
 try{
  const response=await fetch('https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3',{
   method:'POST',headers:{authorization:`Token ${key}`,'content-type':'application/json'},body:JSON.stringify({text:text.slice(0,350)}),signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),
  });
  if(!response.ok||!response.headers.get('content-type')?.startsWith('audio/'))return {provider:'browser',text,notice:'Deepgram unavailable · using system voice'};
  const reader=response.body?.getReader();if(!reader)throw new Error('No audio');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const read=await reader.read();if(read.done)break;size+=read.value.length;if(size>1_000_000)throw new Error('Audio limit');chunks.push(read.value);}}finally{await reader.cancel().catch(()=>{});}
  if(size<32)throw new Error('Empty audio');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {provider:'deepgram',text,bytes};
 }catch{return {provider:'browser',text,notice:signal.aborted?'Voice request canceled':'Deepgram unavailable or timed out · using system voice'};}
}
