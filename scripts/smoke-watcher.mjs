import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=await mkdtemp(join(tmpdir(),'softfex-ui-watch-'));
await mkdir(join(root,'src'));await writeFile(join(root,'src/auth.ts'),'export const n=1;');
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();await page.getByRole('button',{name:/SoftFex/}).click();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();
 await page.getByRole('heading',{name:'0 source files changed',exact:true}).waitFor();
 await writeFile(join(root,'src/auth.ts'),'export const n=2;');
 await page.getByRole('heading',{name:'1 source file changed',exact:true}).waitFor();
 await writeFile(join(root,'.env'),'IGNORED=private');
 const state=await page.evaluate(()=>window.softfex.getState());
 assert.equal(state.changedFiles,1);assert.equal(state.phase,'changes_pending');assert.equal(state.report,undefined);
 await page.screenshot({path:'artifacts/watcher.png'});
 console.log('PASS: real Electron watcher detects external edit; baseline starts empty; no review before trigger. Folder picker response supplied by test.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
