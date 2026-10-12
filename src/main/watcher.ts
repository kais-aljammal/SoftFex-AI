import chokidar, { type FSWatcher } from 'chokidar';
import { lstat, realpath, readdir, open } from 'node:fs/promises';
import { relative, resolve, isAbsolute, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
export const LIMITS = { maxFiles: 12, maxFileChars: 12_000, maxTotalContextChars: 45_000, maxFindings: 12, maxTrackedFiles: 2000, maxBytes: 64_000, maxBaselineChars: 2_000_000 };
const ignoredDirectories = new Set(['.git','.codex','.agents','.aws','node_modules','.next','dist','out','build','release','artifacts','coverage','.venv','vendor','.softfex-local']);
const supported = new Set(['.ts','.tsx','.js','.jsx','.json']);
export function canonicalRelative(path: string) { return path.replace(/\\/g,'/'); }
export function insideRoot(root: string, path: string) { const rel = relative(root,path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../')); }
export function ignoredPath(path: string) {
  return canonicalRelative(path).split('/').some(segment => ignoredDirectories.has(segment.toLowerCase()) || /^\.env/i.test(segment) || /^(?:id_rsa|credentials[^/]*\.json|secrets[^/]*\.json|auth\.json)$/i.test(segment) || /\.(?:pem|key|p12|pfx)$/i.test(segment));
}
export function eligiblePath(path: string) {
  const rel = canonicalRelative(path); const name = basename(rel);
  return !isAbsolute(path) && !rel.includes(':') && !rel.split('/').includes('..') && !ignoredPath(rel)
    && supported.has(extname(name).toLowerCase()) && !/(?:\.min\.|\.generated\.|\.d\.ts$|(?:^|[-.])lock(?:\.|$))/i.test(name);
}
export type SourceFile = { file: string; content: string; hash: string; bytes: number };
export type ReadResult = { ok: true; source: SourceFile } | { ok: false; reason: 'missing' | 'excluded' | 'oversized' | 'unreadable' | 'unstable' };
export async function readSource(root: string, file: string): Promise<ReadResult> {
  if (!eligiblePath(file)) return {ok:false,reason:'excluded'};
  const path = resolve(root,file);
  if (!insideRoot(root,path)) return {ok:false,reason:'excluded'};
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) return {ok:false,reason:'excluded'};
    if (!insideRoot(root,await realpath(path))) return {ok:false,reason:'excluded'};
    if (before.size>LIMITS.maxBytes) return {ok:false,reason:'oversized'};
    const handle = await open(path,'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.size>LIMITS.maxBytes) return {ok:false,reason:'unstable'};
      const buffer = Buffer.alloc(LIMITS.maxBytes+1);
      const {bytesRead} = await handle.read(buffer,0,buffer.length,0);
      const after = await handle.stat();
      if (bytesRead>LIMITS.maxBytes) return {ok:false,reason:'oversized'};
      if (stat.size!==after.size || stat.mtimeMs!==after.mtimeMs || bytesRead!==after.size) return {ok:false,reason:'unstable'};
      if (!insideRoot(root,await realpath(path)) || (await lstat(path)).isSymbolicLink()) return {ok:false,reason:'excluded'};
      const content=buffer.subarray(0,bytesRead).toString('utf8');
      return {ok:true,source:{file:canonicalRelative(file),content,hash:createHash('sha256').update(content).digest('hex'),bytes:bytesRead}};
    } finally { await handle.close(); }
  } catch (error) { return {ok:false,reason:(error as NodeJS.ErrnoException).code==='ENOENT'?'missing':'unreadable'}; }
}
export class WorkspaceWatcher {
  readonly baseline = new Map<string, SourceFile>();
  readonly pending = new Set<string>();
  revision = 0; lastChangeAt = 0; overflow = false;
  private watcher?: FSWatcher; private closed = false; private baselineChars = 0;
  private constructor(readonly root: string, private changed: () => void) {}
  static async create(path: string, changed: () => void) {
    const root = await realpath(path);
    if (!(await lstat(root)).isDirectory()) throw new Error('Choose an accessible project directory.');
    const instance = new WorkspaceWatcher(root,changed);
    const beforeFiles = await instance.listFiles();
    for (const file of beforeFiles) { const read=await readSource(root,file); if(read.ok) instance.recordBaseline(read.source); }
    instance.watcher=chokidar.watch(root, {
      ignoreInitial:true, followSymlinks:false, awaitWriteFinish:{stabilityThreshold:120,pollInterval:40},
      ignored: path => { const rel=relative(root,path); return rel!=='' && (ignoredPath(rel) || !insideRoot(root,path)); },
    });
    instance.watcher.on('all',(event,path)=>{if(['add','change','unlink'].includes(event)) void instance.onFile(path);});
    instance.watcher.on('error',()=>{instance.overflow=true;changed();});
    await new Promise<void>((yes,no)=>{instance.watcher!.once('ready',yes);instance.watcher!.once('error',no);});
    // Close the baseline-to-watcher startup gap using a read-only reconciliation.
    for (const file of new Set([...beforeFiles,...await instance.listFiles()])) await instance.onFile(resolve(root,file));
    return instance;
  }
  async listFiles():Promise<string[]> {
    const files:string[]=[]; let visited=0;
    const visit = async (directory:string):Promise<void> => {
      if (++visited>5000 || files.length>=LIMITS.maxTrackedFiles) {this.overflow=true;return;}
      const entries=await readdir(directory,{withFileTypes:true}); entries.sort((a,b)=>a.name.localeCompare(b.name));
      for(const entry of entries){
        const path=resolve(directory,entry.name); const rel=canonicalRelative(relative(this.root,path));
        if(ignoredPath(rel)||entry.isSymbolicLink())continue;
        if(entry.isDirectory())await visit(path);
        else if(entry.isFile()&&eligiblePath(rel)){if(files.length>=LIMITS.maxTrackedFiles){this.overflow=true;return;}files.push(rel);}
      }
    };
    await visit(this.root);return files;
  }
  private recordBaseline(source:SourceFile){
    const existing=this.baseline.get(source.file); if(existing)this.baselineChars-=existing.content.length;
    const stored={...source,content:this.baselineChars+source.content.length<=LIMITS.maxBaselineChars?source.content:''};
    this.baseline.set(source.file,stored);this.baselineChars+=stored.content.length;
  }
  async onFile(path:string){
    if(this.closed)return;
    const file=canonicalRelative(relative(this.root,path));if(!eligiblePath(file)||!insideRoot(this.root,path))return;
    const read=await readSource(this.root,file);if(this.closed)return;
    const before=this.pending.has(file);
    const same=read.ok?this.baseline.get(file)?.hash===read.source.hash:read.reason==='missing'&&!this.baseline.has(file);
    if(same)this.pending.delete(file);
    else if(this.pending.size<LIMITS.maxTrackedFiles||before)this.pending.add(file);else this.overflow=true;
    if(!same||before){this.revision++;this.lastChangeAt=Date.now();this.changed();}
  }
  async checkpoint(files:SourceFile[]){
    for(const file of files){const now=await readSource(this.root,file.file);if(now.ok&&now.source.hash===file.hash){this.recordBaseline(file);this.pending.delete(file.file);}}
  }
  async close(){this.closed=true;await this.watcher?.close();}
}
