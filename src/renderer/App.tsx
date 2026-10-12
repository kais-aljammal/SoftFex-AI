import {useEffect,useState} from 'react';
import {ShieldCheck,ChevronUp,ChevronLeft,ChevronRight,FolderOpen,Power,ScanLine,ExternalLink,Copy,Volume2,VolumeX,Check,AlertTriangle,LoaderCircle} from 'lucide-react';
import type {AppState,Finding,Result} from '../shared/types';
import {useSpeech} from './useSpeech';
const labels:Record<AppState['phase'],string>={needs_workspace:'Choose workspace',watching:'Watching changes',changes_pending:'Changes queued',reviewing:'Reviewing',report_ready:'Report ready',report_partial:'Partial review',report_outdated:'Outdated',review_failed:'Review failed'};
export function App(){
 const [expanded,setExpanded]=useState(false);const [state,setState]=useState<AppState>();
 const [selected,setSelected]=useState<string>();const [prompt,setPrompt]=useState('');const [showPrompt,setShowPrompt]=useState(false);
 const [error,setError]=useState('');const [copied,setCopied]=useState(false);const [selecting,setSelecting]=useState(false);
 const [notification,setNotification]=useState(false);
 const voice=useSpeech(state);
 useEffect(()=>{const off=window.softfex.onStateChange(setState);void window.softfex.getState().then(setState);return off;},[]);
 useEffect(()=>{setSelected(undefined);setPrompt('');setShowPrompt(false);setCopied(false);},[state?.workspace,state?.report?.reviewId]);
 const finding=state?.report?.findings.find(f=>f.id===selected);
 const stale=state?.report?.status==='outdated';const busy=state?.phase==='reviewing';
 const project=state?.workspace?.split(/[\\/]/).at(-1);
 useEffect(()=>{if(state?.report?.findings.some(f=>f.severity==='high'||f.severity==='critical')&&state.report.status!=='outdated'){setNotification(true);const timer=setTimeout(()=>setNotification(false),9000);return ()=>clearTimeout(timer);}setNotification(false);},[state?.report?.reviewId,state?.report?.status]);
 const compactMode=notification&&!stale&&!busy?'warning':voice.speaking?'speaking':busy?'reviewing':state?.changedFiles?'changes':'collapsed';
 useEffect(()=>{void window.softfex.setWindowMode(expanded?(finding?'detail':'report'):compactMode);},[expanded,!!finding,compactMode]);
 async function act<T,>(operation:Promise<Result<T>>){try{const r=await operation;setError(r.ok?'':r.error);return r;}catch{setError('The operation could not complete. Try again.');return undefined;}}
 async function mode(next:boolean){await act(window.softfex.setWindowMode(next?'report':'collapsed'));setExpanded(next);setSelected(undefined);setShowPrompt(false);}
 async function choose(){setSelecting(true);await act(window.softfex.selectWorkspace());setSelecting(false);}
 async function detail(f:Finding){setSelected(f.id);setPrompt('');setShowPrompt(false);setCopied(false);await act(window.softfex.setWindowMode('detail'));}
 async function back(){setSelected(undefined);setShowPrompt(false);await act(window.softfex.setWindowMode('report'));}
 async function viewPrompt(){const r=await act(window.softfex.getFixPrompt(selected!));if(r?.ok){setPrompt(r.value);setShowPrompt(true);}}
 async function copy(){const r=await act(window.softfex.copyPrompt(selected!));setCopied(!!r?.ok);}
 const collapsedStatus=!state?.workspace?'Choose workspace':busy?'Reviewing':stale?'Outdated':state?.report?`${state.report.findings.length} findings`:state.changedFiles?`${state.changedFiles} files changed`:'Watching';
 const waveform=<span className="waveform" aria-label="Voice playback active">{voice.levels.map((height,i)=><i key={i} style={{height}}/>)}</span>;
 if(!expanded&&compactMode==='warning')return <button className="island-notification" onClick={()=>mode(true)} aria-label="Open SoftFex warning"><span className="notification-mark"><AlertTriangle size={20}/></span><span className="notification-copy"><span className="notification-eyebrow">SOFTFEX REVIEW <span>{state?.report?.findings[0]?.severity}</span></span><strong>{state?.report?.findings[0]?.title}</strong><small>{state?.report?.findings[0]?.file}:{state?.report?.findings[0]?.startLine} · Inspect evidence</small></span>{voice.speaking?waveform:<ChevronRight size={16}/>}</button>;
 if(!expanded)return <button className={`pill ${busy?'is-reviewing':''}`} onClick={()=>mode(true)} aria-label={`Open SoftFex · ${collapsedStatus}`}><ShieldCheck size={16}/><span>SoftFex</span>{voice.speaking?waveform:busy?<LoaderCircle size={13} className="spinner"/>:<i className={`dot ${state?.workspace?'monitoring':''}`}/>}<span className="muted">{voice.speaking?'Speaking':collapsedStatus}</span></button>;
 return <main className="notch">
  <header><ShieldCheck size={20}/><div className="identity"><strong>SoftFex AI</strong><small>{project||'Independent code review'}</small></div>
   {voice.speaking&&waveform}<button className="icon" title={state?.muted?'Voice alerts off':'Voice alerts on'} aria-label={state?.muted?'Unmute':'Mute'} onClick={()=>act(window.softfex.setMute(!state?.muted))}>{state?.muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>
   <button className="icon" aria-label="Quit SoftFex" onClick={()=>window.softfex.quit()}><Power size={14}/></button>
   <button className="icon" aria-label="Collapse" onClick={()=>mode(false)}><ChevronUp size={18}/></button>
  </header>
  {!state?.workspace?<section className="empty"><ShieldCheck size={36}/><h1>Your code. A second look.</h1><p>Watch source changes. Review the evidence.<br/>Keep the correction in your hands.</p><button onClick={choose} disabled={selecting}>{selecting?'Opening project…':'Choose project folder'}</button><div className="voice-setup"><button className="text-button" onClick={voice.testVoice} disabled={state?.muted}><Volume2 size={13}/>Test voice</button><small>{state?.deepgramKeyPresent?'Deepgram Aura 2 configured':'System voice fallback available'}</small></div></section>
  :finding?<>
   <section className="content detail">
    <button className="back" onClick={back}><ChevronLeft size={14}/>All findings</button>
    <div className="meta"><span className={`severity ${finding.severity}`}>{finding.severity}</span><span>{finding.origin==='rule'?'Rule-based':'AI-flagged · potential issue'}</span></div>
    <h1>{finding.title}</h1><div className="location">{finding.file}:{finding.startLine}{finding.endLine!==finding.startLine?`–${finding.endLine}`:''}</div>
    {stale&&<div className="warning"><AlertTriangle size={14}/>Source changed since this finding. Review again.</div>}
    <h2>What's wrong</h2><p>{finding.explanation}</p>
    <h2>Evidence / code excerpt</h2><pre>{finding.evidence}</pre>
    <h2>Why it matters</h2><p>{finding.impact}</p>
    <h2>Suggested correction</h2><p>{finding.recommendation}</p>
    <small>Confidence: {finding.confidence}. This finding does not establish exploitability or full review coverage.</small>
    {showPrompt&&<div className="prompt"><h2>Fix prompt</h2><textarea readOnly aria-label="Fix prompt" value={prompt}/><button onClick={copy} disabled={stale}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy prompt'}</button></div>}
   </section>
   <div className="actions"><button onClick={()=>act(window.softfex.openFinding(finding.id))} disabled={stale}><ExternalLink size={14}/>Open in VS Code</button><button className="primary" onClick={viewPrompt} disabled={stale}><Copy size={14}/>Copy fix prompt</button></div>
  </>:<>
   <section className="content">
    <div className={`status ${busy?'reviewing':''}`} aria-live="polite">{busy?<LoaderCircle size={14} className="spinner"/>:<i className="dot"/>}{labels[state.phase]}</div>
    {!state.report?<><h1>{state.changedFiles} source {state.changedFiles===1?'file':'files'} changed</h1><p>{busy?'Inspecting the latest code snapshot…':state.changedFiles?'Waiting for review.':'Tracking source changes in '+project+'.'}</p></>
    :<>
     <div className="counts"><div><b>{state.changedFiles}</b><span>pending</span></div><div><b>{state.report.reviewedFiles.length}<em>/{state.report.changedFiles}</em></b><span>reviewed</span></div><div><b>{state.report.findings.length}</b><span>findings</span></div></div>
     {state.report.mode==='current_snapshot'&&<small>Manual current-snapshot review · existing source</small>}
     {stale&&<div className="warning"><AlertTriangle size={14}/>Code changed since this report. Review again.</div>}
     {state.report.status==='partial'&&<div className="warning">Results are incomplete. Review coverage is limited.</div>}
     {state.report.findings.map(f=><button className="finding" onClick={()=>detail(f)} key={f.id}><div className="finding-top"><span className={`severity ${f.severity}`}>{f.severity}</span><span className="provenance">{f.origin==='rule'?'Rule-based':'AI-flagged'}</span><ChevronRight size={14}/></div><b>{f.title}</b><small>{f.file}:{f.startLine}</small><p>{f.explanation}</p></button>)}
     {!state.report.findings.length&&<div className="zero"><ShieldCheck size={24}/><p>{state.report.reviewedFiles.length?`No issues detected in the ${state.report.reviewedFiles.length} files reviewed.`:'No eligible source files were reviewed.'}</p></div>}
     <small className="coverage">{state.report.aiStatus==='completed'?'Sonnet 5.5 review completed':state.report.aiStatus==='failed'?'AI review unavailable · local checks shown':state.report.aiStatus==='not_configured'?'Local checks only · API key not configured':'Local checks only · AI review off'}</small>
     {state.report.note&&<p className="note">{state.report.note}</p>}
     {state.report.previousFindings.map(p=><div className={`lifecycle ${p.status==='resolved_in_latest_snapshot'?'resolved':''}`} key={p.finding.id}><b>{p.status==='resolved_in_latest_snapshot'?'This specific finding is no longer detected':'Not re-verified'}</b><small>{p.finding.title} · {p.finding.file}</small></div>)}
     {state.report.skippedFiles.length>0&&<details><summary>{state.report.skippedFiles.length} files skipped</summary>{state.report.skippedFiles.slice(0,5).map(f=><small key={f}>{f}</small>)}{state.report.skippedFiles.length>5&&<small>…and {state.report.skippedFiles.length-5} more</small>}</details>}
    </>}
    <label className="consent"><input type="checkbox" checked={state.aiEnabled} onChange={e=>act(window.softfex.setAiReviewEnabled(e.target.checked))}/>Enable AI review · sends filtered source snippets to Anthropic</label><small>{state.apiKeyPresent?'API key configured locally':'API key not configured'}. Secret filtering is best-effort.</small>
    <div className="workspace-row"><button className="text-button" onClick={choose} disabled={selecting}><FolderOpen size={13}/>Change project</button><span title={state.workspace}>{project}</span></div>
    <div className="voice-row"><button className="text-button" onClick={voice.testVoice} disabled={state.muted}><Volume2 size={13}/>Test voice</button><small>{state.muted?'Voice alerts off':state.deepgramKeyPresent?'Deepgram Aura 2':'System voice fallback'}</small></div>
   </section>
   <div className="actions"><button className="primary full" onClick={()=>act(window.softfex.reviewNow())} disabled={busy}>{busy?<LoaderCircle size={15} className="spinner"/>:<ScanLine size={15}/>} {busy?'Reviewing snapshot…':state.report?'Review Again':'Review Now'}</button></div>
  </>}
  {(error||state?.error)&&<div role="alert" className="error">{error||state?.error}</div>}
  {voice.status&&<div className="voice-status" role="status">{state?.muted?'Voice alerts off; findings remain visible.':voice.status}</div>}
  <footer>{state?.integration==='connected'?'Codex turn completed':state?.integration==='listening'?'Bridge listening · waiting for Codex completion':'Review manually — Codex completion not connected'}</footer>
 </main>;
}
