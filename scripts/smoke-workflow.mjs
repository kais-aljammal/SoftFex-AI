import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {waitState} from './test-helpers.mjs';
const root=await mkdtemp(join(tmpdir(),'softfex-ui-flow-'));await mkdir(join(root,'src'));
const safe=await readFile('tests/fixtures/safe-auth.ts','utf8'),unsafe=await readFile('tests/fixtures/vulnerable-auth.ts','utf8');await writeFile(join(root,'src/auth.ts'),safe);
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:/Open SoftFex/}).click();await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root);
 await writeFile(join(root,'src/auth.ts'),unsafe);await waitState(page,s=>s.changedFiles===1);
 await page.getByRole('button',{name:'Review Now',exact:true}).click();let state=await waitState(page,s=>s.report&&s.phase!=='reviewing');
 assert.equal(state.report.findings.length,1);const id=state.report.findings[0].id;
 await page.getByRole('button',{name:/Potential SQL injection/}).click();await page.getByRole('heading',{name:"What's wrong",exact:true}).waitFor();
 await page.waitForTimeout(300);await page.screenshot({path:'artifacts/issue-evidence.png'});
 await page.getByRole('button',{name:'Fix prompt',exact:true}).click();await page.getByRole('textbox',{name:'Fix prompt',exact:true}).waitFor();
 const prompt=await page.getByRole('textbox',{name:'Fix prompt',exact:true}).inputValue();assert.ok(prompt.includes('src/auth.ts:2-2'));assert.ok(prompt.includes('req.params.id'));
 await page.getByRole('button',{name:'Copy prompt',exact:true}).click();await page.getByRole('button',{name:'Copied',exact:true}).waitFor();
 assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),prompt);
 await page.screenshot({path:'artifacts/finding-details.png'});
 const opened=await page.evaluate(id=>window.softfex.openFinding(id),id);assert.equal(opened.ok,true);
 console.log('PASS: evidence-specific prompt copied to the real clipboard; VS Code launch request accepted for the actual source line.');
 await writeFile(join(root,'src/auth.ts'),safe);await waitState(page,s=>s.phase==='report_outdated');
 const staleCopy=await page.evaluate(id=>window.softfex.copyPrompt(id),id);assert.equal(staleCopy.ok,false);
 await page.getByRole('button',{name:'All findings',exact:true}).click();await page.getByRole('button',{name:'Review Again',exact:true}).click();
 state=await waitState(page,s=>s.phase==='report_ready');assert.equal(state.report.findings.length,0);assert.equal(state.report.previousFindings[0].status,'resolved_in_latest_snapshot');
 await page.screenshot({path:'artifacts/corrected.png'});assert.deepEqual(errors,[]);
 console.log('PASS: source modification marks report outdated and blocks stale clipboard prompt; real corrected scan no longer detects the specific SQL finding.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
