import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {WorkspaceWatcher} from '../src/main/watcher';import {captureSnapshot,changedRange} from '../src/main/snapshot';
test('changed line ranges preserve actual 1-based positions',()=>{assert.deepEqual(changedRange('a\nb\nc','a\nx\nc'),{start:2,end:2});assert.deepEqual(changedRange(undefined,'a\nb'),{start:1,end:2});});
test('snapshot enforces coverage without advancing baseline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'softfex-snapshot-'));let watcher:WorkspaceWatcher|undefined;
 try{watcher=await WorkspaceWatcher.create(root,()=>{});for(let i=0;i<14;i++){const file=`a${i}.ts`;await writeFile(join(root,file),`const n=${i};`);await watcher.onFile(join(root,file));}
 const snapshot=await captureSnapshot(watcher);assert.equal(snapshot.mode,'changed');assert.equal(snapshot.changedFiles,14);assert.equal(snapshot.files.length,12);assert.equal(snapshot.skippedFiles.length,2);assert.ok(snapshot.skippedFiles.every(file=>file.includes('12-file review limit')));assert.equal(watcher.baseline.size,0);assert.equal(watcher.pending.size,14);
 await watcher.checkpoint(snapshot.files);const remaining=await captureSnapshot(watcher);assert.equal(remaining.mode,'changed');assert.equal(remaining.files.length,2);assert.ok(remaining.files.every(file=>!snapshot.files.some(old=>old.file===file.file)));
 await watcher.checkpoint(remaining.files);const current=await captureSnapshot(watcher);assert.equal(current.mode,'current_snapshot');assert.equal(current.changedFiles,14);assert.equal(current.files.length,12);assert.equal(current.skippedFiles.length,2);
 }finally{await watcher?.close();await rm(root,{recursive:true,force:true});}
});
