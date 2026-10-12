import { WorkspaceWatcher, readSource, LIMITS, type SourceFile } from './watcher';
export type SnapshotFile = SourceFile & { changedStart: number; changedEnd: number; context: string; coveredLines: Set<number> };
export type Snapshot = { revision: number; files: SnapshotFile[]; changedFiles: number; skippedFiles: string[]; mode:'changed'|'current_snapshot'; overflow:boolean };
export function changedRange(before: string | undefined, after: string) {
  const current=after.split(/\r?\n/);if(before===undefined)return {start:1,end:current.length};
  const previous=before.split(/\r?\n/);let first=0;while(first<Math.min(previous.length,current.length)&&previous[first]===current[first])first++;
  let oldEnd=previous.length-1,newEnd=current.length-1;while(oldEnd>=first&&newEnd>=first&&previous[oldEnd]===current[newEnd]){oldEnd--;newEnd--;}
  return {start:Math.min(first+1,current.length),end:Math.max(Math.min(first+1,current.length),newEnd+1)};
}
export async function captureSnapshot(watcher:WorkspaceWatcher, signal?:AbortSignal):Promise<Snapshot>{
  for(let attempt=0;attempt<2;attempt++){
    const waitStart=Date.now();
    while(Date.now()-watcher.lastChangeAt<500){
      if(signal?.aborted)throw new Error('Review canceled.');
      if(Date.now()-waitStart>=3000)throw new Error('Changes still arriving — try again.');
      await new Promise(r=>setTimeout(r,50));
    }
    if(signal?.aborted)throw new Error('Review canceled.');
    const revision=watcher.revision;
    const mode=watcher.pending.size?'changed':'current_snapshot';
    const paths=mode==='changed'?[...watcher.pending]:await watcher.listFiles();
    const candidates:SourceFile[]=[];const skippedFiles:string[]=[];
    for(const file of paths){const read=await readSource(watcher.root,file);if(read.ok)candidates.push(read.source);else skippedFiles.push(`${file} (${read.reason})`);}
    candidates.sort((a,b)=>a.content.length-b.content.length||a.file.localeCompare(b.file));
    const files:SnapshotFile[]=[];let total=0;
    for(const source of candidates){
      if(files.length>=LIMITS.maxFiles||source.content.length>LIMITS.maxFileChars){skippedFiles.push(source.file);continue;}
      const previous=watcher.baseline.get(source.file);
      const changed=mode==='current_snapshot'?{start:1,end:source.content.split(/\r?\n/).length}:changedRange(previous?.content||undefined,source.content);
      const lines=source.content.split(/\r?\n/);const coveredLines=new Set<number>();
      const start=Math.max(1,changed.start-8),end=Math.min(lines.length,changed.end+8);
      for(let line=start;line<=end;line++)coveredLines.add(line);
      for(let line=1;line<=Math.min(6,lines.length);line++)if(/^(?:import|export .* from|const .*require\()/.test(lines[line-1]))coveredLines.add(line);
      const context=[...coveredLines].sort((a,b)=>a-b).map(line=>`${line}: ${lines[line-1]}`).join('\n');
      if(total+context.length>LIMITS.maxTotalContextChars){skippedFiles.push(source.file);continue;}
      total+=context.length;files.push({...source,changedStart:changed.start,changedEnd:changed.end,context,coveredLines});
    }
    let stable=watcher.revision===revision;
    for(const file of files){const read=await readSource(watcher.root,file.file);if(!read.ok||read.source.hash!==file.hash)stable=false;}
    if(stable)return {revision,files,changedFiles:paths.length,skippedFiles,mode,overflow:watcher.overflow};
  }
  throw new Error('Changes still arriving — try again.');
}
