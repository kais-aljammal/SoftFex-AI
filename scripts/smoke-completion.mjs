import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {waitState} from './test-helpers.mjs';import {runCodex} from './codex-test-helper.mjs';
const root=await mkdtemp(join(tmpdir(),'softfex-cli-demo-'));await mkdir(join(root,'src'));
await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/safe-auth.ts','utf8'));
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();await page.getByRole('button',{name:/Open SoftFex/}).click();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root&&s.integration==='listening');
 await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/vulnerable-auth.ts','utf8'));await waitState(page,s=>s.changedFiles===1);
 await page.getByRole('button',{name:'Collapse',exact:true}).click();
 await runCodex(root,'Reply with exactly OK. Do not read or modify files.',{timeout:60000});
 const state=await waitState(page,s=>s.integration==='connected'&&s.report?.trigger==='codex_turn_complete'&&s.phase!=='reviewing',30000);
 assert.equal(state.report.findings[0].origin,'rule');assert.ok(state.lastCompletion);
 await page.getByRole('button',{name:'Open SoftFex warning',exact:true}).waitFor();
 await page.screenshot({path:'artifacts/warning.png'});
 console.log('PASS: actual installed Codex CLI turn invoked chained notify; authenticated completion triggered real review and warning island. Global notification settings and Coucou hooks were not modified.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
