import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureCredentialStorage,readCredential} from '../src/main/credentials';
test('packaged credentials use private runtime storage and never developer dotenv',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'softfex-credential-read-'));const project=join(directory,'project'),runtime=join(directory,'runtime');
 const previous=process.env.ANTHROPIC_API_KEY;
 try{
  delete process.env.ANTHROPIC_API_KEY;
  await mkdir(project);await mkdir(runtime);
  await writeFile(join(project,'.env'),'ANTHROPIC_API_KEY=dev-value\n');
  configureCredentialStorage(runtime,false);assert.equal(readCredential(project,'ANTHROPIC_API_KEY'),'dev-value');
  configureCredentialStorage(runtime,true);assert.equal(readCredential(project,'ANTHROPIC_API_KEY'),undefined);
  await writeFile(join(runtime,'credentials.env'),'ANTHROPIC_API_KEY=private-value\n');
  assert.equal(readCredential(project,'ANTHROPIC_API_KEY'),'private-value');
  configureCredentialStorage(runtime,false);assert.equal(readCredential(project,'ANTHROPIC_API_KEY'),'private-value');
  process.env.ANTHROPIC_API_KEY='process-value';assert.equal(readCredential(project,'ANTHROPIC_API_KEY'),'process-value');
  assert.equal(await import('node:fs/promises').then(fs=>fs.readFile(join(project,'.env'),'utf8')),'ANTHROPIC_API_KEY=dev-value\n');
 }finally{if(previous===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=previous;await rm(directory,{recursive:true,force:true});}
});
