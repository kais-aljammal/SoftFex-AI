import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

// Keep transient diagnostic fragments private and bounded. Only fixed labels
// leave this collector; never return the CLI's task, source or raw error text.
export function createCodexDiagnostics(){
 let stdout='',stderr='',turnStarted=false,failedTools=0,completedTools=0,startedTools=0,reasoningItems=0,messageItems=0,fileChanges=0,failedFileChanges=0;
 const found=new Set();
 const classify=(text,tool=false)=>{
  if(/\b(?:401\s+unauthorized|authentication failed|invalid (?:api key|authentication)|not logged in|unauthorized access)\b/i.test(text))found.add('authentication failure');
  if(/\b(?:429(?:\s|:)|rate.?limit exceeded|usage limit|quota exceeded|insufficient_quota)\b/i.test(text))found.add('rate or quota limit');
  if(/\b(?:error sending request|stream disconnected|connection (?:reset|refused)|network is unreachable|unable to resolve|dns resolution|tls handshake|request timed out)\b/i.test(text))found.add('network or transport failure');
  if(tool&&/\b(?:access is denied|permission denied|sandbox[^\r\n]{0,60}(?:denied|blocked)|approval[^\r\n]{0,40}(?:denied|rejected)|blocked by (?:policy|application control))\b/i.test(text))found.add('tool permission or sandbox denial');
 };
 const stdoutLine=line=>{
  if(line.length>16384)return;
  try{
   const event=JSON.parse(line);
   if(event.type==='turn.started')turnStarted=true;
   if(event.type==='error'&&typeof event.message==='string')classify(event.message,true);
   if(event.type==='turn.failed'&&typeof event.error?.message==='string')classify(event.error.message,true);
   const item=event.item;
   if(event.type==='item.started'&&item?.type==='command_execution')startedTools++;
   if(event.type==='item.completed'&&item?.type==='reasoning')reasoningItems++;
   if(event.type==='item.completed'&&item?.type==='agent_message')messageItems++;
   if(event.type==='item.completed'&&item?.type==='file_change'){fileChanges++;if(item.status==='failed')failedFileChanges++;}
   if(event.type==='item.completed'&&item?.type==='command_execution'){
    completedTools++;
    if(typeof item.exit_code==='number'&&item.exit_code!==0){failedTools++;if(typeof item.aggregated_output==='string')classify(item.aggregated_output,true);}
   }
  }catch{/* Ignore non-protocol output; never echo it. */}
 };
 return {
  stdout(chunk){const lines=(stdout+chunk.toString()).split('\n');stdout=(lines.pop()||'').slice(-16384);for(const line of lines)stdoutLine(line);},
  stderr(chunk){const lines=(stderr+chunk.toString()).split('\n');stderr=(lines.pop()||'').slice(-8192);for(const line of lines){if(/^\s*WARNING\b/i.test(line))continue;if(line.length<=8192)classify(line,/\bERROR\b/.test(line));}},
  summary(){if(stderr&&!/^\s*WARNING\b/i.test(stderr))classify(stderr,/\bERROR\b/.test(stderr));if(stdout){stdoutLine(stdout);stdout='';}const detail=[...found].join(', ');return `${detail?`observed diagnostic: ${detail}`:'no classified external failure'}; ${turnStarted?'turn started':'no turn-start event'}; ${completedTools} tool commands completed; ${Math.max(0,startedTools-completedTools)} active; ${failedTools} unsuccessful; ${reasoningItems} reasoning items; ${messageItems} messages; ${fileChanges} file-change items; ${failedFileChanges} failed file changes`;},
  clear(){stdout='';stderr='';found.clear();},
 };
}

// Live integration tests use the installed CLI and existing notification chain.
// Never emit CLI payloads: they can contain task text or local tool output.
// Controlled fixture generation inherits the installed model. Only its effort
// is overridden per test; global configuration and the product reviewer stay unchanged.
export function runCodex(workspace,prompt,{timeout=90000}={}){
 let child;
 const promise=new Promise((yes,no)=>{
  const diagnostic=createCodexDiagnostics();
  child=spawn(process.execPath,[resolve('scripts/start-codex.cjs'),'exec','--json','--skip-git-repo-check','--ephemeral','--sandbox','workspace-write','-c','approval_policy="never"','-c','model_reasoning_effort="medium"','-C',workspace,prompt],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let finished=false;
  child.stdout.on('data',chunk=>{if(!finished)diagnostic.stdout(chunk);});child.stderr.on('data',chunk=>{if(!finished)diagnostic.stderr(chunk);});
  const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);diagnostic.clear();error?no(error):yes();};
  const timer=setTimeout(()=>{
   // Kill the known test process tree, not unrelated user Codex sessions.
   if(process.platform==='win32'&&child.pid){const cleanup=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});cleanup.once('error',()=>{});}
   else child.kill('SIGTERM');
   finish(new Error(`Controlled Codex turn exceeded the test deadline (${diagnostic.summary()}).`));
  },timeout);
  child.once('error',()=>finish(new Error('Installed Codex CLI could not launch.')));
  child.once('exit',code=>finish(code===0?undefined:new Error(`Controlled Codex turn failed with exit code ${code??'unavailable'} (${diagnostic.summary()}).`)));
 });
 // Attach immediately so a slow UI assertion cannot create an unhandled reject.
 promise.catch(()=>{});
 return promise;
}
