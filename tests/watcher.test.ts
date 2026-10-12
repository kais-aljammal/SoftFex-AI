import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceWatcher,eligiblePath,insideRoot,readSource} from '../src/main/watcher';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
test('eligibility excludes secrets, generated files, locks and traversal',()=>{
  for(const p of ['.env','.env.local','src/.env.test','node_modules/a.ts','dist/a.js','out/a.js','secrets.json','credentials-local.json','.git/a.json','.codex/auth.json','a.pem','id_rsa','package-lock.json','pnpm-lock.yaml','yarn.lock','a.min.js','a.generated.ts','a.d.ts','../a.ts','C:\\outside.ts','a.ts:stream'])assert.equal(eligiblePath(p),false,p);
  for(const p of ['src/auth.ts','src/a.tsx','src/a.jsx','src/a.js','src/config.json'])assert.equal(eligiblePath(p),true,p);
  assert.equal(insideRoot(join(tmpdir(),'root'),join(tmpdir(),'root-other','a.ts')),false);
});
test('real external edits coalesce after a quiet baseline; ignored edits do not count',async()=>{
  const root=await mkdtemp(join(tmpdir(),'softfex-watch-'));let watcher:WorkspaceWatcher|undefined;
  try{
    await mkdir(join(root,'src'));await writeFile(join(root,'src/a.ts'),'export const n = 1;');
    watcher=await WorkspaceWatcher.create(root,()=>{});assert.equal(watcher.pending.size,0);
    await writeFile(join(root,'src/a.ts'),'export const n = 2;');await writeFile(join(root,'src/a.ts'),'export const n = 3;');
    await writeFile(join(root,'.env'),'DO_NOT_REVIEW=private');
    for(let i=0;i<40&&watcher.pending.size===0;i++)await sleep(50);
    assert.deepEqual([...watcher.pending],['src/a.ts']);
    const read=await readSource(root,'src/a.ts');assert.ok(read.ok);await watcher.checkpoint([read.source]);assert.equal(watcher.pending.size,0);
    await rm(join(root,'src/a.ts'));for(let i=0;i<40&&watcher.pending.size===0;i++)await sleep(50);
    assert.equal(watcher.pending.has('src/a.ts'),true);
  }finally{await watcher?.close();await rm(root,{recursive:true,force:true});}
});
test('canonical read refuses symlink outside selected workspace',async()=>{
  const root=await mkdtemp(join(tmpdir(),'softfex-scope-'));const outside=await mkdtemp(join(tmpdir(),'softfex-outside-'));
  try{await writeFile(join(outside,'a.ts'),'private');await symlink(outside,join(root,'escape'),'junction');assert.equal((await readSource(root,'escape/a.ts')).ok,false);}
  finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
