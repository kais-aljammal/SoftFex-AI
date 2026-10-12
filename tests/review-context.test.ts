import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gatherReviewContext,relativeImports,importCandidates,CONTEXT_LIMITS} from '../src/main/review-context';
import {selectReviewPlaybooks} from '../src/main/review-playbooks';
import {buildReviewPayload} from '../src/main/llm';
import {LIMITS} from '../src/main/watcher';
import {source} from './helpers';

test('correctness is always selected, with at most two source-relevant supporting playbooks',()=>{
  assert.deepEqual(selectReviewPlaybooks([{file:'math.ts',content:'export const double = (n: number) => n * 2;'}]).map(p=>p.discipline),['correctness']);
  const selected=selectReviewPlaybooks([{file:'Widget.tsx',content:'const [items, setItems] = useState([]); fetch("/api/items").then(r => r.json());'}]);
  assert.deepEqual(selected.map(p=>p.discipline),['correctness','frontend','integration']);
  assert.ok(selectReviewPlaybooks([{file:'db.ts',content:'db.query(`SELECT ${input}`);'}]).some(p=>p.discipline==='security'));
  assert.ok(selected.every(p=>p.guidance.length>50));
});
test('static imports exclude comments, nonliteral calls and outside-workspace candidates',()=>{
  assert.deepEqual(relativeImports('src/main.ts',`// import x from './comment';\nconst text="import x from './string'";\nimport {x} from './contract.js';\nexport {y} from './util';\nconst dynamic = import(variable);\nrequire('./legacy');`),['./contract.js','./util','./legacy']);
  assert.ok(importCandidates('src/main.ts','./contract.js').includes('src/contract.ts'));
  assert.equal(importCandidates('src/main.ts','../../private').length,0);
  assert.equal(importCandidates('src/main.ts','../.env').length,0);
  assert.doesNotThrow(()=>relativeImports('broken.ts','import { x from "./contract"; function {'));
});
test('bounded related context includes direct contracts and nearby callers, never unrelated or private files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'softfex-context-'));
  try{
    await mkdir(join(root,'src'));
    const changed={...source(`import { contract } from './contract.js';\nexport const client = () => contract.id;`),file:'src/client.ts'};
    await writeFile(join(root,'src','contract.ts'),'export const contract = { id: 1 };');
    await writeFile(join(root,'src','caller.ts'),`import { client } from './client.js';\nexport const run = () => client();`);
    await writeFile(join(root,'src','unrelated.ts'),'export const unrelated = "UNRELATED_PRIVATE_DATA";');
    await writeFile(join(root,'.env'),'SYNTHETIC_PRIVATE_VALUE=never-send');
    const context=await gatherReviewContext(root,[changed],['src/caller.ts','src/unrelated.ts','.env']);
    assert.deepEqual(context.map(file=>file.file),['src/contract.ts','src/caller.ts']);
    assert.deepEqual(context.map(file=>file.relation),['dependency','caller']);
    assert.ok(context.every(file=>file.relatedTo.includes('src/client.ts')));
    assert.ok(!JSON.stringify(context).includes('UNRELATED_PRIVATE_DATA'));
    assert.ok(!JSON.stringify(context).includes('never-send'));
    const body=JSON.parse(buildReviewPayload([changed],[],{relatedFiles:context,taskContext:'Implement the client contract.'})!);
    assert.equal(body.coverage.reviewedFiles,1);assert.equal(body.coverage.contextOnlyFiles,2);
    assert.equal(body.relatedContext[0].file,'src/contract.ts');
    assert.equal(body.taskContext,'Implement the client contract.');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('cross-file context enforces file and character caps; linked directories cannot leak outside source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'softfex-context-bounds-'));const outside=await mkdtemp(join(tmpdir(),'softfex-context-private-'));
  try{
    await mkdir(join(root,'src'));
    const content=Array.from({length:8},(_,i)=>`import {v${i}} from './dep${i}';`).join('\n');
    const changed={...source(content),file:'src/client.ts'};
    for(let i=0;i<8;i++)await writeFile(join(root,'src',`dep${i}.ts`),Array.from({length:300},(_,line)=>`export const v${i}_${line} = ${line};`).join('\n'));
    const context=await gatherReviewContext(root,[changed],[]);
    assert.ok(context.length<=CONTEXT_LIMITS.maxFiles);assert.ok(context.reduce((sum,file)=>sum+file.context.length,0)<=CONTEXT_LIMITS.maxChars);
    assert.ok(context.every(file=>file.context.length<=CONTEXT_LIMITS.maxFileChars&&file.truncated));
    await writeFile(join(outside,'private.ts'),'export const privateValue = "DO_NOT_DISCLOSE";');
    const linkedDirectory=join(root,'src','escape');
    await symlink(outside,linkedDirectory,process.platform==='win32'?'junction':'dir');
    // Prove the import candidate really resolves to an existing outside file.
    assert.equal(await realpath(join(linkedDirectory,'private.ts')),await realpath(join(outside,'private.ts')));
    const leaked=await gatherReviewContext(root,[{...source(`import x from './escape/private'; import y from '../../private';`),file:'src/client.ts'}],[]);
    assert.equal(leaked.length,0);
    assert.ok(!JSON.stringify(leaked).includes('DO_NOT_DISCLOSE'));
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('serialized request bounds include task text and escaped source; excessive input fails closed',()=>{
  const file=source('const key = "synthetic-private-value";');
  const payload=buildReviewPayload([file],[],{taskContext:'Use apiKey="synthetic-private-value". '+ 'x'.repeat(3000)});
  assert.ok(payload&&payload.length<LIMITS.maxTotalContextChars);const parsed=JSON.parse(payload);
  assert.ok(parsed.taskContext.length<=1600);assert.ok(!parsed.taskContext.includes('synthetic-private-value'));
  assert.equal(buildReviewPayload([{...source('x'),context:'"'.repeat(45000)}],[]),undefined);
});
