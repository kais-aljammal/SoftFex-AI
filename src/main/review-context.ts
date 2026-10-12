import ts from 'typescript';
import {posix} from 'node:path';
import {eligiblePath,readSource,LIMITS,type SourceFile} from './watcher';
import type {SnapshotFile} from './snapshot';

export type ReviewContextFile=SourceFile&{context:string;relatedTo:string[];relation:'dependency'|'caller';truncated:boolean};
export const CONTEXT_LIMITS={maxFiles:4,maxChars:8000,maxFileChars:4000,maxCallerCandidates:24};
const extensions=['','.ts','.tsx','.js','.jsx','.json','/index.ts','/index.tsx','/index.js','/index.jsx'];

/** Static literal imports only. No module execution, package traversal or tsconfig expansion. */
export function relativeImports(file:string,content:string):string[]{
  const source=ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const imports=new Set<string>();
  const add=(node:ts.Node|undefined)=>{if(node&&ts.isStringLiteral(node)&&node.text.startsWith('.')&&!node.text.includes('\\')&&!node.text.includes(':'))imports.add(node.text);};
  const visit=(node:ts.Node)=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))add(node.moduleSpecifier);
    else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'))&&node.arguments.length===1)add(node.arguments[0]);
    ts.forEachChild(node,visit);
  };
  visit(source);return [...imports].slice(0,16);
}
export function importCandidates(importer:string,specifier:string){
  const base=posix.normalize(posix.join(posix.dirname(importer),specifier));
  // TypeScript commonly uses .js specifiers for .ts sources; retain the actual source path.
  const bases=/\.(?:js|jsx)$/.test(base)?[base,base.replace(/\.jsx?$/,'.ts'),base.replace(/\.jsx?$/,'.tsx')]:[base];
  return [...new Set(bases.flatMap(path=>extensions.map(extension=>path+extension)))].filter(eligiblePath);
}
function numberedExcerpt(content:string,limit:number){
  const result:string[]=[];let length=0;const lines=content.split(/\r?\n/);
  for(let index=0;index<lines.length;index++){
    const line=`${index+1}: ${lines[index]}`;if(length+line.length+(result.length?1:0)>limit)break;
    result.push(line);length+=line.length+(result.length>1?1:0);
  }
  return {context:result.join('\n'),truncated:result.length<lines.length};
}
export async function gatherReviewContext(root:string,files:SnapshotFile[],workspaceFiles:string[],signal?:AbortSignal):Promise<ReviewContextFile[]>{
  const changed=new Set(files.map(file=>file.file));
  const sourceChars=files.reduce((sum,file)=>sum+file.context.length,0);
  // Reserve task-context and payload labels within the existing total source budget.
  let remaining=Math.max(0,Math.min(CONTEXT_LIMITS.maxChars,LIMITS.maxTotalContextChars-sourceChars-2400));
  const results:ReviewContextFile[]=[];const cache=new Map<string,SourceFile|undefined>();
  const read=async(file:string)=>{
    if(signal?.aborted)throw new Error('Review canceled.');
    if(cache.has(file))return cache.get(file);
    const result=await readSource(root,file);const source=result.ok&&result.source.content.length<=LIMITS.maxFileChars?result.source:undefined;
    cache.set(file,source);return source;
  };
  const add=(source:SourceFile,relatedTo:string,relation:'dependency'|'caller')=>{
    if(changed.has(source.file))return;
    const existing=results.find(file=>file.file===source.file);if(existing){if(!existing.relatedTo.includes(relatedTo))existing.relatedTo.push(relatedTo);return;}
    if(results.length>=CONTEXT_LIMITS.maxFiles||remaining<100)return;
    const excerpt=numberedExcerpt(source.content,Math.min(CONTEXT_LIMITS.maxFileChars,remaining));if(!excerpt.context)return;
    remaining-=excerpt.context.length;results.push({...source,...excerpt,relatedTo:[relatedTo],relation});
  };
  for(const file of files){
    for(const specifier of relativeImports(file.file,file.content)){
      for(const candidate of importCandidates(file.file,specifier)){
        const source=await read(candidate);if(source){add(source,file.file,'dependency');break;}
      }
      if(results.length>=CONTEXT_LIMITS.maxFiles||remaining<100)break;
    }
    if(results.length>=CONTEXT_LIMITS.maxFiles||remaining<100)break;
  }
  if(results.length>=CONTEXT_LIMITS.maxFiles||remaining<100)return results;
  // Inspect only nearby potential callers; never send unrelated scanned source to the model.
  const directories=new Set(files.map(file=>posix.dirname(file.file)));
  const candidates=workspaceFiles.filter(file=>!changed.has(file)&&eligiblePath(file)&&directories.has(posix.dirname(file)))
    .sort((a,b)=>a.localeCompare(b)).slice(0,CONTEXT_LIMITS.maxCallerCandidates);
  for(const candidate of candidates){
    const source=await read(candidate);if(!source)continue;
    for(const specifier of relativeImports(source.file,source.content)){
      const target=files.find(file=>importCandidates(source.file,specifier).includes(file.file));
      if(target)add(source,target.file,'caller');
    }
    if(results.length>=CONTEXT_LIMITS.maxFiles||remaining<100)break;
  }
  return results;
}
