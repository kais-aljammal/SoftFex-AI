import type {SnapshotFile} from '../src/main/snapshot';
export function source(content:string):SnapshotFile{return {file:'src/auth.ts',content,hash:'hash',bytes:content.length,changedStart:1,changedEnd:content.split('\n').length,context:content,coveredLines:new Set(content.split('\n').map((_,i)=>i+1))};}
