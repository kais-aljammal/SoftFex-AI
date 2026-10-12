import {_electron as electron} from 'playwright';import electronPath from 'electron';import assert from 'node:assert/strict';import {resolve} from 'node:path';
const app=await electron.launch({executablePath:electronPath,args:['.']});
try{
 const page=await app.firstWindow();const state=await page.evaluate(()=>window.softfex.getState());
 const result=await app.evaluate(async(_electron,{root,state})=>{
  const fs=process.getBuiltinModule('fs').promises;const path=process.getBuiltinModule('path');const {execFileSync}=process.getBuiltinModule('child_process');
  const env=await fs.readFile(path.join(root,'.env'),'utf8');
  const keys=['ANTHROPIC_API_KEY','DEEPGRAM_API_KEY'].map(name=>env.match(new RegExp(`^${name}=([^\\r\\n]*)`,'m'))?.[1].trim()).filter(Boolean);
  const contents=[JSON.stringify(state)];
  async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else contents.push(await fs.readFile(file,'utf8'));}}
  await visit(path.join(root,'dist/renderer'));
  const tracked=execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of tracked)contents.push(execFileSync('git',['show',`:${file}`],{cwd:root,encoding:'utf8',maxBuffer:20_000_000}));
  return {configured:keys.length,clean:keys.every(key=>contents.every(text=>!text.includes(key)))};
 },{root:resolve('.'),state});
 assert.equal(result.configured,2);assert.equal(result.clean,true);
 assert.equal((await page.evaluate(()=>window.softfex.setWindowMode('invalid'))).ok,false);
 assert.equal((await page.evaluate(()=>window.softfex.openFinding('../outside.ts'))).ok,false);
 assert.equal(await page.evaluate(()=>window.open('about:blank')),null);
 console.log('PASS: actual configured keys absent from renderer state, renderer bundle and Git index; invalid capabilities and popup denied. Secret comparison performed in Electron main without returning values.');
}finally{await app.close();}
