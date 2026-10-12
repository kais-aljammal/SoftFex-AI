import { app, ipcMain, BrowserWindow, dialog, clipboard } from 'electron';
import { createNotch, positionNotch } from './window';
import type { AppState, Result } from '../shared/types';
import { readApiKey, readCredential, checkConnectivity } from './credentials';
import { resolve } from 'node:path';
import { WorkspaceWatcher,readSource } from './watcher';
import { ReviewCoordinator } from './review';
import {openEditor} from './open-editor';
import {fixPrompt} from '../shared/prompts';
import {redactSource} from './llm';
import {startBridge} from './bridge-server';
import {generateSpeech,speechSummary} from './speech';
import type {WindowMode,SpeechResult} from '../shared/types';
let win: BrowserWindow;
let watcher: WorkspaceWatcher | undefined;
let reviewer: ReviewCoordinator | undefined;
let selecting = false;
let workspaceGeneration = 0;
let speechController:AbortController|undefined;
let bridge:Awaited<ReturnType<typeof startBridge>>|undefined;
let keyRefresh:ReturnType<typeof setInterval>|undefined;
const spoken=new Set<string>();
const state: AppState = { phase: 'needs_workspace', changedFiles: 0, revision: 0, muted: false, aiEnabled: false, apiKeyPresent: false, apiConnectivity: 'unchecked', integration: 'manual' };
function publish() { if(state.phase==='reviewing'||state.phase==='report_outdated')speechController?.abort();if (win && !win.isDestroyed()) win.webContents.send('softfex:state', state); }
app.setName('SoftFex AI');
const projectRoot = resolve(__dirname, '../..');
if (process.argv.includes('--voice-check')) {
  void app.whenReady().then(async()=>{
    const result=await generateSpeech(readCredential(projectRoot,'DEEPGRAM_API_KEY'),'SoftFex voice connectivity test.',new AbortController().signal);
    console.log(result.provider==='deepgram'?`Deepgram Aura 2 connectivity verified; received ${result.bytes?.byteLength} audio bytes.`:result.notice);
    app.exit(result.provider==='deepgram'?0:1);
  });
} else if (process.argv.includes('--api-check')) {
  void app.whenReady().then(async () => {
    const key = readApiKey(projectRoot);
    if (!key) { console.log('Anthropic key is not configured. Run npm run setup:key.'); app.exit(1); return; }
    const result = await checkConnectivity(key);
    console.log(result.message); app.exit(result.ok ? 0 : 1);
  });
} else if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(() => {
  win = createNotch();
  state.apiKeyPresent=!!readApiKey(projectRoot);
  function handle(name: string, callback: (...args: any[]) => unknown) {
    ipcMain.handle(`softfex:${name}`, async (event, ...args) => {
      if(event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return {ok:false,error:'Invalid sender'};
      try { return await callback(...args); } catch { return {ok:false,error:'The operation could not complete. Try again.'}; }
    });
  }
  handle('getState', () => {state.apiKeyPresent=!!readApiKey(projectRoot);state.deepgramKeyPresent=!!readCredential(projectRoot,'DEEPGRAM_API_KEY');return state;});
  handle('setWindowMode', (mode): Result => {
    if (!['collapsed','changes','reviewing','warning','speaking','report','detail'].includes(mode)) return { ok: false, error: 'Invalid request' };
    positionNotch(win, mode as WindowMode); return { ok: true, value: undefined };
  });
  handle('selectWorkspace', async ():Promise<Result> => {
    if(selecting)return {ok:false,error:'Folder selection already open.'};selecting=true;
    try {
      const choice=await dialog.showOpenDialog(win,{properties:['openDirectory'],title:'Choose a SoftFex project'});
      if(choice.canceled||!choice.filePaths[0])return {ok:true,value:undefined};
      const generation=++workspaceGeneration;reviewer?.close();reviewer=undefined;speechController?.abort();spoken.clear();await watcher?.close();watcher=undefined;
      Object.assign(state,{workspace:undefined,report:undefined,phase:'needs_workspace',changedFiles:0,revision:0,error:undefined,lastCompletion:undefined});publish();
      watcher=await WorkspaceWatcher.create(choice.filePaths[0],()=>{
        if(workspaceGeneration!==generation||!watcher)return;
        state.changedFiles=watcher.pending.size;state.revision=watcher.revision;
        if(state.report)state.report={...state.report,status:'outdated'};
        state.phase=reviewer?.active?'reviewing':state.report?'report_outdated':state.changedFiles?'changes_pending':'watching';
        if(watcher.overflow)state.error='Workspace observation limit reached. Select a smaller project.';publish();
      });
      state.workspace=watcher.root;state.phase=watcher.pending.size?'changes_pending':'watching';state.changedFiles=watcher.pending.size;state.revision=watcher.revision;
      reviewer=new ReviewCoordinator(watcher,state,publish,()=>readApiKey(projectRoot));
      if(watcher.overflow)state.error='Workspace observation limit reached. Select a smaller project.';
      publish();return {ok:true,value:undefined};
    }catch{state.error='Project folder is missing or unreadable. Choose another folder.';publish();return {ok:false,error:state.error};}
    finally{selecting=false;}
  });
  handle('reviewNow', ():Result=>{if(!reviewer)return {ok:false,error:'Choose a project first.'};void reviewer.request('manual');return {ok:true,value:undefined};});
  handle('setAiReviewEnabled', (enabled):Result=>{
    if(typeof enabled!=='boolean')return {ok:false,error:'Invalid request.'};
    state.apiKeyPresent=!!readApiKey(projectRoot);
    if(enabled&&!state.apiKeyPresent)return {ok:false,error:'Set ANTHROPIC_API_KEY locally first.'};
    state.aiEnabled=enabled;if(!enabled)reviewer?.cancelAI();publish();return {ok:true,value:undefined};
  });
  async function currentFinding(id:unknown){
    if(typeof id!=='string'||id.length>100||!watcher||!state.report)throw new Error('Finding unavailable.');
    const finding=state.report.findings.find(f=>f.id===id);if(!finding)throw new Error('Finding unavailable.');
    const now=await readSource(watcher.root,finding.file);
    if(state.report.status==='outdated'||!now.ok||now.source.hash!==finding.snapshotHash){state.report={...state.report,status:'outdated'};state.phase='report_outdated';publish();throw new Error('Source changed since this finding. Review again.');}
    return finding;
  }
  handle('getFixPrompt',async(id):Promise<Result<string>>=>{try{return {ok:true,value:redactSource(fixPrompt(await currentFinding(id)))};}catch{return {ok:false,error:'Source changed or finding unavailable. Review again before copying.'};}});
  handle('copyPrompt',async(id):Promise<Result>=>{try{const prompt=redactSource(fixPrompt(await currentFinding(id)));clipboard.writeText(prompt);return {ok:true,value:undefined};}catch{return {ok:false,error:'Source changed or finding unavailable. Review again before copying.'};}});
  handle('openFinding',async(id):Promise<Result>=>{try{const finding=await currentFinding(id);await openEditor(watcher!.root,finding.file,finding.startLine);return {ok:true,value:undefined};}catch{return {ok:false,error:'Source changed or editor unavailable. Review again, then retry.'};}});
  handle('setMute',(value):Result=>{if(typeof value!=='boolean')return {ok:false,error:'Invalid request.'};state.muted=value;if(value)speechController?.abort();publish();return {ok:true,value:undefined};});
  handle('requestSpeech',async(request):Promise<Result<SpeechResult>>=>{
    if(state.muted)return {ok:false,error:'Voice alerts off; findings remain visible.'};
    if(!request||typeof request!=='object'||!['test','report'].includes(request.kind))return {ok:false,error:'Invalid voice request.'};
    let text='SoftFex voice test. Potential issues will be announced after review.';
    if(request.kind==='report'){
      if(!state.report||typeof request.reviewId!=='string'||request.reviewId!==state.report.reviewId||spoken.has(request.reviewId))return {ok:false,error:'Report already announced or unavailable.'};
      const summary=speechSummary(state.report);if(!summary)return {ok:false,error:'No current important finding to announce.'};text=summary;
      spoken.add(request.reviewId);if(spoken.size>128)spoken.delete(spoken.values().next().value!);
    }
    speechController?.abort();const controller=new AbortController();speechController=controller;
    const result=await generateSpeech(readCredential(projectRoot,'DEEPGRAM_API_KEY'),text,controller.signal);
    if(controller.signal.aborted||state.muted)return {ok:false,error:'Voice request canceled.'};
    return {ok:true,value:result};
  });
  handle('stopSpeech',():Result=>{speechController?.abort();return {ok:true,value:undefined};});
  void startBridge(app.getPath('userData'),()=>state.workspace,()=>{
    state.integration='connected';state.lastCompletion=Date.now();publish();void reviewer?.request('codex_turn_complete');
  }).then(value=>{bridge=value;state.integration='listening';publish();}).catch(()=>{state.integration='manual';publish();});
  keyRefresh=setInterval(()=>{const ai=!!readApiKey(projectRoot),voice=!!readCredential(projectRoot,'DEEPGRAM_API_KEY');if(ai!==state.apiKeyPresent||voice!==state.deepgramKeyPresent){state.apiKeyPresent=ai;state.deepgramKeyPresent=voice;publish();}},1500);
  handle('quit', () => { app.quit();return {ok:true,value:undefined}; });
});
let quitting=false;
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;if(keyRefresh)clearInterval(keyRefresh);reviewer?.close();speechController?.abort();void Promise.all([watcher?.close(),bridge?.close()]).finally(()=>app.quit());});
app.on('window-all-closed', () => app.quit());
