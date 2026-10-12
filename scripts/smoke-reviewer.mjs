import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {waitState,openSettings} from './test-helpers.mjs';
const root=await mkdtemp(join(tmpdir(),'softfex-ui-review-'));await mkdir(join(root,'src'));
const safe=await readFile('tests/fixtures/safe-auth.ts','utf8');const unsafe=await readFile('tests/fixtures/vulnerable-auth.ts','utf8');await writeFile(join(root,'src/auth.ts'),safe);
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:/SoftFex/}).click();await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
 await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await page.getByRole('heading',{name:'0 source files changed',exact:true}).waitFor();
 await writeFile(join(root,'src/auth.ts'),unsafe);await page.getByRole('heading',{name:'1 source file changed',exact:true}).waitFor();
 await page.getByRole('button',{name:'Review Now',exact:true}).click();
 let state=await waitState(page,s=>s.phase==='report_ready'||s.phase==='report_partial');assert.equal(state.report.findings[0].origin,'rule');assert.equal(state.report.findings[0].startLine,2);assert.equal(state.changedFiles,0);
 console.log('PASS: actual changed unsafe source produced a local finding in Electron.');
 await writeFile(join(root,'src/math.ts'),'// Return the arithmetic mean of a nonempty list.\nexport function average(nums: number[]) {\n  return nums.reduce((a,b) => a+b, 0) / 0;\n}\n');
 await waitState(page,s=>s.changedFiles===1);
 await openSettings(page);await page.getByRole('checkbox',{name:/Enable AI review/}).click();await waitState(page,s=>s.aiEnabled);await page.getByRole('button',{name:'Review Again',exact:true}).click();
 state=await waitState(page,s=>s.phase!=='reviewing'&&s.report?.reviewedFiles.includes('src/math.ts'),100000);assert.equal(state.report.aiStatus,'completed',state.report.note);assert.ok(state.report.findings.some(f=>f.origin==='ai'&&f.file==='src/math.ts'));
 assert.ok(state.report.previousFindings.some(p=>p.status==='not_reverified'),'Auth was outside this review, so it cannot resolve.');
 await page.screenshot({path:'artifacts/reviewer.png'});assert.deepEqual(errors,[]);
 console.log('PASS: real Sonnet 5.5 structured review returned source-validated independent AI finding; uncovered prior SQL finding remains not re-verified.');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
