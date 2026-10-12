import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,rm,readdir,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {_electron as electron} from 'playwright';
import {execFileSync} from 'node:child_process';
import {waitState} from './test-helpers.mjs';
const temporary=await mkdtemp(join(tmpdir(),'softfex-packaged-smoke-'));
const install=join(temporary,'application'),workspace=join(temporary,'project');
const portable=process.argv.includes('--portable');
const keep=process.argv.includes('--keep');
if(keep)console.log(`Retained packaged test installation: ${install}`);
let app;
try{
 let executablePath=join(install,'SoftFex AI.exe');
 if(portable){
  await mkdir(install);const artifact=(await readdir('release')).find(name=>/^SoftFex-AI-.*-windows-x64\.exe$/.test(name));assert.ok(artifact,'Portable artifact missing');
  executablePath=join(install,artifact);await cp(resolve('release',artifact),executablePath);
 }else if(process.argv.includes('--zip')){
  await mkdir(install);const artifact=(await readdir('release')).find(name=>/^SoftFex-AI-.*-windows-x64\.zip$/.test(name));assert.ok(artifact,'ZIP artifact missing');
  execFileSync(resolve('node_modules/7zip-bin/win/x64/7za.exe'),['x',resolve('release',artifact),`-o${install}`,'-y','-bso0','-bsp0','-bse0'],{stdio:'ignore',timeout:60000});
 }else await cp(resolve('release/win-unpacked'),install,{recursive:true});
 await mkdir(join(workspace,'src'),{recursive:true});
 await writeFile(join(workspace,'src/math.ts'),'export const double = (value:number) => value * 2;\n');
 app=await electron.launch({executablePath,cwd:temporary,timeout:30000});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',()=>errors.push('renderer error'));
 const packaged=await app.evaluate(({app})=>({packaged:app.isPackaged,appPath:app.getAppPath(),userData:app.getPath('userData')}));
 assert.equal(packaged.packaged,true);assert.equal(packaged.appPath.startsWith(resolve('.')),false,'Packaged runtime loaded from repository');
 const open=page.getByRole('button',{name:/^Open SoftFex/});if(await open.count())await open.click();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},workspace);
 await page.getByRole('button',{name:'Choose project folder'}).click();
 await waitState(page,s=>s.workspace===workspace);
 await page.evaluate(()=>window.softfex.setMute(true));
 await writeFile(join(workspace,'src/math.ts'),'export const double = (value:number) => value * 3;\n');
 await waitState(page,s=>s.changedFiles===1);
 await page.getByRole('button',{name:'Review Now'}).click();
 await waitState(page,s=>s.report?.reviewedFiles.includes('src/math.ts'));
 for(const name of ['start-codex.cjs','softfex-notify.cjs','configure-key.ps1','launch-key-setup.ps1'])await access(join(packaged.userData,'runtime','scripts',name));
 await access(join(packaged.userData,'bridge.json'));
 const first=await page.evaluate(()=>window.softfex.getState());assert.equal(first.apiKeyPresent,true);assert.equal(first.deepgramKeyPresent,true);
 assert.deepEqual(errors,[]);
 await app.close();app=await electron.launch({executablePath,cwd:temporary,timeout:30000});
 const restarted=await app.firstWindow();const after=await restarted.evaluate(()=>window.softfex.getState());assert.equal(after.apiKeyPresent,true);assert.equal(after.deepgramKeyPresent,true);
 console.log(`PASS: ${portable?'portable executable':'unpacked application'} copied outside repository, native launch, renderer/preload, writable runtime/bridge, actual file watcher and local review. Folder picker mocked; no live provider, speaker or subjective visual claim.`);
}finally{
 await app?.close().catch(()=>{});
 const expected=join(tmpdir(),'softfex-packaged-smoke-');
 if(!keep&&temporary.startsWith(expected))await rm(temporary,{recursive:true,force:true});
}
