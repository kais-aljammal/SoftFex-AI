import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:/Open SoftFex/}).click();
 await page.getByRole('button',{name:'Test voice',exact:true}).click();
 await page.getByLabel('Voice playback active',{exact:true}).waitFor({timeout:15000});
 await page.getByText('Speaking · Deepgram Aura 2',{exact:true}).waitFor();
 await page.screenshot({path:'artifacts/voice-playing.png'});
 try{await page.getByText('Deepgram Aura 2 playback completed',{exact:true}).waitFor({timeout:20000});}catch(error){console.log('Voice status:',await page.locator('.voice-status').textContent());throw error;}
 assert.equal(await page.getByLabel('Voice playback active',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Test voice',exact:true}).click();await page.getByLabel('Voice playback active',{exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:'Mute',exact:true}).click();await page.getByRole('button',{name:'Unmute',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Voice playback active',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: real Deepgram MP3 decoded and played in Electron; waveform visible only during playback; mute stops audio. Human audibility is a separate check.');
}finally{await app.close();}
