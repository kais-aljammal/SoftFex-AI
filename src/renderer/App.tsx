import {useEffect,useRef,useState} from 'react';
import {ShieldCheck,ChevronUp,ChevronDown,ChevronLeft,ChevronRight,FolderOpen,Power,ScanLine,ExternalLink,Copy,Volume2,VolumeX,Check,AlertTriangle,LoaderCircle,Settings2} from 'lucide-react';
import type {AppState,Finding,Result} from '../shared/types';
import {useSpeech} from './useSpeech';

const labels:Record<AppState['phase'],string>={needs_workspace:'Choose a project',watching:'Watching',changes_pending:'Changes detected',reviewing:'Reviewing changes',report_ready:'Review complete',report_partial:'Review incomplete',report_outdated:'Update needed',review_failed:'Review unavailable'};
const quantity=(count:number,singular:string,plural=`${singular}s`)=>`${count} ${count===1?singular:plural}`;
function voiceLabel(status:string){
 if(status==='Deepgram Aura 2 playback completed')return 'Alert played';
 if(status==='System voice playback completed')return 'System voice played';
 if(status.startsWith('Speaking'))return 'Speaking';
 if(status.startsWith('Audio playback failed')||status.startsWith('Audio needs activation'))return 'Trying system voice…';
 if(status.startsWith('Voice needs activation'))return 'Voice needs activation · use Test voice';
 if(status.includes('unavailable'))return 'Voice unavailable · findings remain visible';
 return status;
}

export function App(){
 const [expanded,setExpanded]=useState(false),[state,setState]=useState<AppState>();
 const [selected,setSelected]=useState<string>(),[prompt,setPrompt]=useState(''),[showPrompt,setShowPrompt]=useState(false);
 const [error,setError]=useState(''),[copied,setCopied]=useState(false),[selecting,setSelecting]=useState(false);
 const [notification,setNotification]=useState(false);
 const promptElement=useRef<HTMLDivElement>(null);
 const voice=useSpeech(state);

 useEffect(()=>{const off=window.softfex.onStateChange(setState);void window.softfex.getState().then(setState);return off;},[]);
 useEffect(()=>{setSelected(undefined);setPrompt('');setShowPrompt(false);setCopied(false);setError('');},[state?.workspace,state?.report?.reviewId]);
 useEffect(()=>{if(showPrompt)promptElement.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});},[showPrompt]);

 const report=state?.report;
 const finding=report?.findings.find(f=>f.id===selected);
 const stale=report?.status==='outdated',busy=state?.phase==='reviewing';
 const project=state?.workspace?.split(/[\\/]/).at(-1);
 const importantFinding=report?.findings.find(f=>f.severity==='critical')||report?.findings.find(f=>f.severity==='high');
 useEffect(()=>{
  if(importantFinding&&report?.status!=='outdated'&&report?.status!=='failed'){
   setNotification(true);const timer=setTimeout(()=>setNotification(false),9000);return ()=>clearTimeout(timer);
  }
  setNotification(false);
 },[report?.reviewId,report?.status,importantFinding?.id]);
 const compactMode=notification&&!stale&&!busy?'warning':voice.speaking?'speaking':busy?'reviewing':state?.changedFiles?'changes':'collapsed';
 useEffect(()=>{void window.softfex.setWindowMode(expanded?(finding?'detail':'report'):compactMode);},[expanded,!!finding,compactMode]);

 async function act<T,>(operation:Promise<Result<T>>){
  try{const result=await operation;setError(result.ok?'':result.error);return result;}
  catch{setError('Could not complete that action. Try again.');return undefined;}
 }
 function mode(next:boolean){setExpanded(next);setSelected(undefined);setShowPrompt(false);}
 async function choose(){setSelecting(true);await act(window.softfex.selectWorkspace());setSelecting(false);}
 function detail(next:Finding){setSelected(next.id);setPrompt('');setShowPrompt(false);setCopied(false);setError('');}
 function back(){setSelected(undefined);setShowPrompt(false);setError('');}
 async function viewPrompt(){if(!selected)return;const result=await act(window.softfex.getFixPrompt(selected));if(result?.ok){setPrompt(result.value);setShowPrompt(true);}}
 async function copy(){if(!selected)return;const result=await act(window.softfex.copyPrompt(selected));setCopied(!!result?.ok);}

 const collapsedStatus=!state?.workspace?'Choose project':busy?'Reviewing':state.phase==='review_failed'?'Review unavailable':stale?'Update needed':state.phase==='report_partial'||report?.status==='partial'?'Review incomplete':state.changedFiles?`${quantity(state.changedFiles,'file')} changed`:report?quantity(report.findings.length,'finding'):'Watching';
 const waveform=<span className="waveform" aria-label="Voice playback active">{voice.levels.map((height,index)=><i key={index} style={{height}}/>)}</span>;
 const issueState=stale?'state-stale':state?.phase==='review_failed'?'state-failed':importantFinding?'state-warning':'';
 const duration=report?.finishedAt?Math.max(0,(report.finishedAt-report.startedAt)/1000):undefined;
 const coverage=report?`${report.reviewedFiles.length}/${report.changedFiles} reviewed · ${report.skippedFiles.length} skipped`:'';
 const integration=state?.integration==='connected'?'Codex completion received':state?.integration==='listening'?'Waiting for Codex completion':'Manual review available';

 if(!expanded&&compactMode==='warning'&&importantFinding)return <button className={`island-notification ${importantFinding.severity}`} onClick={()=>mode(true)} aria-label="Open SoftFex warning">
  <span className="notification-mark"><AlertTriangle size={19}/></span>
  <span className="notification-copy"><span className="notification-eyebrow">Potential issue <span>{importantFinding.severity}</span></span><strong>{importantFinding.title}</strong><small>{importantFinding.file}:{importantFinding.startLine}</small></span>
  {voice.speaking?waveform:<ChevronRight size={16}/>}
 </button>;

 if(!expanded)return <button className={`pill ${busy?'is-reviewing':''} ${issueState}`} onClick={()=>mode(true)} aria-label={`Open SoftFex · ${collapsedStatus}`} title="Open independent code review">
  <ShieldCheck size={16}/><span>SoftFex</span>
  {voice.speaking?waveform:busy?<LoaderCircle size={13} className="spinner"/>:<i className={`dot ${state?.workspace?'monitoring':''}`}/>}
  <span className="muted">{voice.speaking?'Speaking':collapsedStatus}</span>
 </button>;

 return <main className={`notch ${finding?'issue-view':'report-view'}`}>
  <header>
   <ShieldCheck size={20}/><div className="identity"><strong>SoftFex AI</strong><small title={state?.workspace}>{project||'Independent code review'}</small></div>
   {voice.speaking&&waveform}
   <button className="icon" title={state?.muted?'Enable voice alerts':'Mute voice alerts'} aria-label={state?.muted?'Unmute':'Mute'} onClick={()=>act(window.softfex.setMute(!state?.muted))}>{state?.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
   <button className="icon" title="Quit SoftFex" aria-label="Quit SoftFex" onClick={()=>window.softfex.quit()}><Power size={15}/></button>
   <button className="icon" title="Collapse island" aria-label="Collapse" onClick={()=>mode(false)}><ChevronUp size={18}/></button>
  </header>

  {!state?.workspace?<section className="empty">
   <span className="welcome-mark"><ShieldCheck size={29}/></span><h1>Your code. A second look.</h1>
   <p>Catch potential issues in real changes.<br/>Inspect the evidence. Stay in control.</p>
   <button className="primary" onClick={choose} disabled={selecting}><FolderOpen size={15}/>{selecting?'Opening project…':'Choose project folder'}</button>
   <div className="voice-setup"><button className="text-button" onClick={voice.testVoice} disabled={state?.muted}><Volume2 size={13}/>Test voice</button><small>{state?.deepgramKeyPresent?'Voice alerts ready':'System voice available'}</small></div>
  </section>:finding?<>
   <section className="content detail" key={finding.id}>
    <button className="back" onClick={back}><ChevronLeft size={14}/>All findings</button>
    <div className="meta"><span className={`severity ${finding.severity}`}>{finding.severity}</span><span>{finding.origin==='rule'?'Local check':'Sonnet review'}</span><span className="category">{finding.category}</span></div>
    <h1>{finding.title}</h1><div className="location">{finding.file}:{finding.startLine}{finding.endLine!==finding.startLine?`–${finding.endLine}`:''}</div>
    {stale&&<div className="warning"><AlertTriangle size={14}/>Source changed. Review again before acting.</div>}
    {busy&&<div className="review-in-progress"><LoaderCircle size={14} className="spinner"/>Checking the latest changes…</div>}
    <h2>Evidence</h2><pre tabIndex={0} aria-label="Source evidence"><code>{finding.evidence}</code></pre>
    <h2>What's wrong</h2><p>{finding.explanation}</p>
    <h2>Why it matters</h2><p>{finding.impact}</p>
    <h2>Suggested correction</h2><p>{finding.recommendation}</p>
    <div className="confidence"><span className="confidence-dot"/>{finding.confidence[0].toUpperCase()+finding.confidence.slice(1)} confidence · verify before changing code</div>
    {showPrompt&&<div className="prompt" ref={promptElement}><h2>Fix prompt</h2><p className="prompt-hint">Copy this into your coding agent. Review the proposed fix.</p><textarea readOnly aria-label="Fix prompt" value={prompt}/><button className="primary" onClick={copy} disabled={stale||busy}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy prompt'}</button></div>}
   </section>
   <div className="actions"><button onClick={()=>act(window.softfex.openFinding(finding.id))} disabled={stale||busy}><ExternalLink size={14}/>Open in VS Code</button><button className="primary" onClick={viewPrompt} disabled={stale||busy} title="Preview the fix prompt before copying"><Copy size={14}/>Fix prompt</button></div>
  </>:<>
   <section className="content report-content" key={report?.reviewId||'watching'}>
    <div className={`status ${busy?'reviewing':''} ${issueState}`} aria-live="polite">{busy?<LoaderCircle size={13} className="spinner"/>:<i className="dot"/>}{labels[state.phase]}{state.changedFiles>0&&report&&<span className="pending-count">{quantity(state.changedFiles,'change')}</span>}</div>
    {!report?<div className="watching-summary"><h1>{quantity(state.changedFiles,'source file')} changed</h1><p>{busy?'Inspecting the latest source…':state.changedFiles?'Ready for a second look.':'Source changes will appear here.'}</p></div>:<>
     <div className="report-summary"><h1>{quantity(report.findings.length,'finding')}</h1><span>{coverage}{duration!==undefined?` · ${duration<10?duration.toFixed(1):Math.round(duration)}s`:''}</span></div>
     <small className="snapshot-label">{report.mode==='current_snapshot'?'Current project snapshot · eligible source only':'Pending changes · reviewed source only'}</small>
     {stale&&<div className="warning"><AlertTriangle size={14}/>Code changed since this review. Review again.</div>}
     {report.status==='partial'&&<div className="warning"><AlertTriangle size={14}/>Limited coverage. Some source was not reviewed.</div>}
     <div className="findings-list">{report.findings.map(item=><button className="finding" onClick={()=>detail(item)} key={item.id}>
      <div className="finding-top"><span className={`severity ${item.severity}`}>{item.severity}</span><span className="provenance">{item.category==='security'?'Security':item.category==='correctness'?'Correctness':item.category==='reliability'?'Reliability':'Engineering'}</span><ChevronRight size={14}/></div>
      <b>{item.title}</b><small>{item.file}:{item.startLine}</small><p>{item.explanation}</p>
     </button>)}</div>
     {!report.findings.length&&<div className="zero"><ShieldCheck size={24}/><div><strong>{report.reviewedFiles.length?'No findings in reviewed source':'No source reviewed'}</strong><p>{report.reviewedFiles.length?'This review does not establish that the project is issue-free.':'No eligible source files were included.'}</p></div></div>}
     <small className={`coverage ${report.aiStatus==='failed'?'coverage-limited':''}`}>{report.aiStatus==='completed'?'Sonnet 5.5 + local checks':report.aiStatus==='failed'?'AI incomplete · local checks available':report.aiStatus==='not_configured'?'Local checks · add an API key for AI review':'Local checks · AI review off'}</small>
     {report.note&&<p className="note">{report.note}</p>}
     {report.previousFindings.map(previous=><div className={`lifecycle ${previous.status==='resolved_in_latest_snapshot'?'resolved':''}`} key={previous.finding.id}>
      <span>{previous.status==='resolved_in_latest_snapshot'?<Check size={13}/>:<AlertTriangle size={13}/>}</span><div><b>{previous.status==='resolved_in_latest_snapshot'?'Issue no longer detected in reviewed code':'Not re-verified'}</b><small>{previous.finding.title} · {previous.finding.file}</small></div>
     </div>)}
     {report.skippedFiles.length>0&&<details className="skipped"><summary>{quantity(report.skippedFiles.length,'file')} skipped<ChevronDown size={12}/></summary>{report.skippedFiles.slice(0,5).map(file=><small key={file}>{file}</small>)}{report.skippedFiles.length>5&&<small>…and {report.skippedFiles.length-5} more</small>}</details>}
    </>}
    <details className="review-settings" onToggle={event=>{if(event.currentTarget.open)event.currentTarget.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}}>
     <summary><Settings2 size={13}/><span>Review settings</span><ChevronDown size={13}/></summary>
     <div className="settings-content">
      <label className="consent"><input type="checkbox" checked={state.aiEnabled} onChange={event=>act(window.softfex.setAiReviewEnabled(event.target.checked))}/><span><strong>Enable AI review</strong><small>Send filtered source and available task context to Anthropic.</small></span></label>
      <small className="privacy-note">{state.apiKeyPresent?'API key stored locally.':'API key not configured.'} Secret filtering is best-effort.</small>
      <small className="privacy-note">Latest Codex task is supporting context, not proof of completion. Kept in memory until you change projects.</small>
      <div className="workspace-row"><button className="text-button" onClick={choose} disabled={selecting}><FolderOpen size={13}/>Change project</button><span title={state.workspace}>{project}</span></div>
      <div className="voice-row"><button className="text-button" onClick={voice.testVoice} disabled={state.muted}><Volume2 size={13}/>Test voice</button><small>{state.muted?'Muted':state.deepgramKeyPresent?'Deepgram Aura 2':'System voice'}</small></div>
      <div className="integration-detail"><span className="dot"/><span>{integration}</span></div>
     </div>
    </details>
   </section>
   <div className="actions"><button className="primary full" onClick={()=>act(window.softfex.reviewNow())} disabled={busy}>{busy?<LoaderCircle size={15} className="spinner"/>:<ScanLine size={15}/>} {busy?'Reviewing snapshot…':report?'Review Again':'Review Now'}</button></div>
  </>}
  {(error||state?.error)&&<div role="alert" className="error"><AlertTriangle size={13}/><span>{error||state?.error}</span></div>}
  {voice.status&&<div className={`voice-status ${voice.speaking?'voice-active':''}`} role="status" title={voice.status}><Volume2 size={11}/><span>{state?.muted?'Voice alerts muted':voice.speaking?'Speaking':voiceLabel(voice.status)}</span></div>}
 </main>;
}
