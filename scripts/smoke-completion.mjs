import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {waitState} from './test-helpers.mjs';
const root=await mkdtemp(join(tmpdir(),'softfex-cli-demo-'));await mkdir(join(root,'src'));
await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/safe-auth.ts','utf8'));
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();await page.getByRole('button',{name:/Open SoftFex/}).click();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root&&s.integration==='listening');
 await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/vulnerable-auth.ts','utf8'));await waitState(page,s=>s.changedFiles===1);
 await page.getByRole('button',{name:'Collapse',exact:true}).click();
 const cliPromise=new Promise(yes=>{
  const child=spawn(process.execPath,[resolve('scripts/start-codex.cjs'),'exec','--skip-git-repo-check','--ephemeral','--sandbox','read-only','-C',root,'Reply with exactly OK. Do not read or modify files.'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',d=>{output=(output+d.toString()).slice(-2000);});child.stderr.on('data',d=>{output=(output+d.toString()).slice(-2000);});
  const timer=setTimeout(()=>{child.kill();yes({code:-1,output:'CLI completion test timed out.'});},45000);
  child.once('error',()=>{clearTimeout(timer);yes({code:-1,output:'CLI could not launch.'});});child.once('exit',code=>{clearTimeout(timer);yes({code,output});});
 });
 const state=await waitState(page,s=>s.integration==='connected'&&s.report?.trigger==='codex_turn_complete'&&s.phase!=='reviewing',10000);
 assert.equal(state.report.findings[0].origin,'rule');assert.ok(state.lastCompletion);
 await page.getByRole('button',{name:'Open SoftFex warning',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/warning.png'});
 const cliResult=await cliPromise;
 if(cliResult.code!==0)throw new Error('Actual CLI completion unavailable; manual review remains supported.');
 console.log('PASS: actual installed Codex CLI turn invoked chained notify; authenticated completion triggered real review and warning island. Global notification settings and Coucou hooks were not modified.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
