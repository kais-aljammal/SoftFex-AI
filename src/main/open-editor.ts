import {shell} from 'electron';
import {spawn} from 'node:child_process';
import {access,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {insideRoot,eligiblePath} from './watcher';
export function editorUri(path:string,line:number){
 const segments=path.replace(/\\/g,'/').split('/');
 return `vscode://file/${segments.map((s,i)=>i===0&&/^[A-Za-z]:$/.test(s)?s:encodeURIComponent(s)).join('/')}:${line}:1`;
}
export async function openEditor(root:string,file:string,line:number){
 if(!eligiblePath(file)||!Number.isSafeInteger(line)||line<1)throw new Error('Invalid source location.');
 const path=await realpath(resolve(root,file));if(!insideRoot(root,path))throw new Error('Source is outside the selected project.');
 const candidates=[join(process.env.LOCALAPPDATA||'','Programs','Microsoft VS Code','Code.exe'),join(process.env.ProgramFiles||'','Microsoft VS Code','Code.exe')];
 for(const exe of candidates){
  try{await access(exe);}catch{continue;}
  try{
   await new Promise<void>((yes,no)=>{const child=spawn(exe,['--goto',`${path}:${line}:1`],{shell:false,windowsHide:true,stdio:'ignore',detached:true,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ANTHROPIC_API_KEY:undefined,DEEPGRAM_API_KEY:undefined}});child.once('error',no);child.once('spawn',()=>{child.unref();yes();});});
   return;
  }catch{/* Try the registered protocol if the native executable cannot launch. */}
 }
 await shell.openExternal(editorUri(path,line));
}
