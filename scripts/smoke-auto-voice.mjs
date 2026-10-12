import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {waitState,openSettings} from './test-helpers.mjs';import {observeVoice,voiceEvidence} from './voice-observer.mjs';import {execFileSync} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'softfex-auto-voice-'));await mkdir(join(root,'src'));await mkdir('artifacts',{recursive:true});
await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/safe-auth.ts','utf8'));
const app=await electron.launch({executablePath:process.env.SOFTFEX_TEST_EXECUTABLE||electronPath,args:process.env.SOFTFEX_TEST_EXECUTABLE?[]:['.']});let page;
try{
 page=await app.firstWindow();await page.getByRole('button',{name:/Open SoftFex/}).click();
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},root);await page.getByRole('button',{name:'Choose project folder',exact:true}).click();await waitState(page,s=>s.workspace===root);
 await page.evaluate(()=>window.softfex.setMute(false));await observeVoice(app,page);await writeFile(join(root,'src/auth.ts'),await readFile('tests/fixtures/vulnerable-auth.ts','utf8'));await waitState(page,s=>s.changedFiles===1);
 await page.getByRole('button',{name:'Review Now',exact:true}).click();await waitState(page,s=>s.phase==='report_ready');
 await page.waitForFunction(()=>window.__qaAudioEvents.some(event=>event.event==='playing')&&window.__qaAudioEvents.some(event=>event.event==='ended')&&window.__qaWaveformOverlap?.active&&window.__qaWaveformOverlap?.audioPlaying&&!window.__qaAudioPlaying&&!document.querySelector('[aria-label="Voice playback active"]'),undefined,{timeout:25000});
 const evidence=await voiceEvidence(app,page);
 const response=evidence.main.findLast(event=>event.event==='softfex:requestSpeech result'&&event.kind==='report');
 assert.equal(response?.ok,true);assert.equal(response?.provider,'deepgram');assert.ok(evidence.renderer.waveformOverlap?.active&&evidence.renderer.waveformOverlap?.audioPlaying);assert.ok(!evidence.renderer.audioEvents.some(event=>event.event==='error'));
 if(process.env.SOFTFEX_TEST_EXECUTABLE){
  const existingPromptIds=execFileSync('powershell.exe',['-NoProfile','-Command',"Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Select-Object -ExpandProperty ProcessId"],{encoding:'utf8',timeout:10000}).trim().split(/\s+/).filter(id=>/^\d+$/.test(id)).map(Number);
  const reopen=page.getByRole('button',{name:/Open SoftFex/});if(await reopen.count())await reopen.click();
  await openSettings(page);await page.getByRole('button',{name:'Update Anthropic key',exact:true}).click();
  await new Promise(resolve=>setTimeout(resolve,2500));
  const result=execFileSync('powershell.exe',['-NoProfile','-Command',`$existing=@(${existingPromptIds.join(',')}); $targets=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.ProcessId -ne $PID -and $existing -notcontains $_.ProcessId -and $_.CommandLine -like '*-File*configure-key.ps1*' -and $_.CommandLine -like '*SoftFex AI*' -and $_.CommandLine -like '*-Provider anthropic*'}); if($targets.Count -eq 0){exit 2}; foreach($target in $targets){Stop-Process -Id $target.ProcessId -ErrorAction Stop}; Write-Output 'PASS'`],{encoding:'utf8',timeout:10000});
  assert.match(result,/PASS/);evidence.keySetup='Actual UI action opened local PowerShell configure helper; canceled before entering or changing credentials. Masked-input helper persistence and restart tested separately.';
 }
 await writeFile(process.env.SOFTFEX_TEST_EXECUTABLE?'artifacts/packaged-auto-voice.json':'artifacts/auto-voice.json',JSON.stringify({result:'PASS',environment:process.env.SOFTFEX_TEST_EXECUTABLE?'packaged outside repository':'source Electron',...evidence},null,2));
 console.log('PASS: automatic local high-severity finding triggers real Deepgram audio playing event and truthful waveform. No Sonnet call in this isolated check.');
}catch(error){await writeFile('artifacts/auto-voice.json',JSON.stringify({result:'FAIL',...await voiceEvidence(app,page)},null,2));throw error;}
finally{await app.close();await rm(root,{recursive:true,force:true});}
