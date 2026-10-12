import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';

// Repackage the verified application without changing any executable/runtime byte.
const base=resolve(process.argv[2]||'release/SoftFex-AI-0.1.0-windows-x64.zip');
const output=resolve('release/SoftFex-AI-0.1.0-windows-x64-with-code.zip');
assert.notEqual(base,output,'Keep the original verified archive intact.');
const expected='1f0c1b503ba93fe1ce70b8816ba14a2113cf0484a06d227d984474527b1f55a4';
assert.equal(createHash('sha256').update(readFileSync(base)).digest('hex'),expected,'Base archive differs from the verified Windows beta.');
const sevenZip=resolve('node_modules/7zip-bin/win/x64/7za.exe');
const seven=(args,options={})=>execFileSync(sevenZip,args,{stdio:'ignore',timeout:60000,...options});
const git=(...args)=>execFileSync('git',args,{maxBuffer:20_000_000});
const names=git('ls-tree','-r','--name-only','HEAD').toString().trim().split('\n');
const sensitive=/(^|\/)(?:\.env(?:\..*)?|node_modules|dist|out|build|release|artifacts|\.softfex-local|\.aws|\.codex|\.agents|\.git|auth\.json|credentials[^/]*\.json|secrets\.[^/]+)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore|exe|msi)$/i;
for(const name of names)assert.ok(name==='.env.example'||!sensitive.test(name),`Prohibited tracked source file: ${name}`);
const recognized=/\b(?:sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
let keys=[];try{keys=readFileSync('.env','utf8').split(/\r?\n/).map(line=>line.match(/^(?:ANTHROPIC_API_KEY|DEEPGRAM_API_KEY)=(.*)$/)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2')).filter(Boolean);}catch{}
function scan(bytes){assert.ok(!recognized.test(bytes.toString('utf8')),'Recognized credential in bundle.');for(const key of keys)assert.ok(!bytes.includes(Buffer.from(key)),'Configured credential in bundle.');}
function walk(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(directory,entry.name)):[join(directory,entry.name)]);}
mkdirSync('release',{recursive:true});
const temporary=mkdtempSync(resolve('release/bundle-'));const sourceArchive=join(temporary,'source.zip'),stage=join(temporary,'payload'),verification=join(temporary,'verified');
try{
 mkdirSync(stage);seven(['x',base,`-o${stage}`,'-y']);
 const runtime=new Map(walk(stage).map(path=>[relative(stage,path),createHash('sha256').update(readFileSync(path)).digest('hex')]));
 git('-c','core.autocrlf=false','archive','--format=zip',`--output=${sourceArchive}`,'HEAD');
 seven(['x',sourceArchive,`-o${join(stage,'Code')}`,'-y']);
 const commit=git('rev-parse','HEAD').toString().trim();
 writeFileSync(join(stage,'START HERE.txt'),`SoftFex AI Windows beta\r\n\r\n1. Extract ALL files before opening the app.\r\n2. Double-click SoftFex AI.exe. Codex is NOT required to open SoftFex.\r\n3. Choose your project and configure your Anthropic key in the masked local prompt.\r\n4. Enable AI review and use Review Now, or connect Codex using Code/README.md.\r\n\r\nCode/ contains the full tracked repository source at ${commit}.\r\nNo keys or private runtime data are included. Code/ excludes Git history and\r\ninstalled dependencies; required production dependencies remain in the app.\r\nThe application runtime is the unchanged, verified beta 1; the subsequent\r\nworkspace-navigation correction is available in the included source only.\r\n\r\nKeep resources, locales, DLLs and other application files together.\r\nAutomatic Codex integration requires Node.js 24+, Python 3.11+ and Codex CLI.\r\nDeepgram is optional; system speech is the fallback. This beta is unsigned.\r\n`);
 for(const path of walk(stage))scan(readFileSync(path));
 // Create, then extract the final ZIP and prove it contains every source file
 // and exactly the original application bytes. This also rejects stale outputs.
 if(readFileSync(base).length===0)throw new Error('Empty base archive');
 const stagedZip=join(temporary,'bundle.zip');seven(['a','-tzip','-mx=3',stagedZip,'.'],{cwd:stage,timeout:120000});
 seven(['x',stagedZip,`-o${verification}`,'-y']);
 for(const [name,hash] of runtime)assert.equal(createHash('sha256').update(readFileSync(join(verification,name))).digest('hex'),hash,`Changed application file: ${name}`);
 for(const name of names)assert.ok(readFileSync(join(verification,'Code',...name.split('/'))).equals(git('show',`HEAD:${name}`)),`Source export differs: ${name}`);
 const expectedFiles=new Set([...runtime.keys(),...names.map(name=>join('Code',...name.split('/'))),'START HERE.txt']);
 for(const path of walk(verification)){assert.ok(expectedFiles.has(relative(verification,path)),'Unexpected bundle file.');scan(readFileSync(path));}
 writeFileSync(output,readFileSync(stagedZip));
 const hash=createHash('sha256').update(readFileSync(output)).digest('hex');
 writeFileSync(output+'.sha256',`${hash}  ${output.split(sep).at(-1)}\n`);
 console.log(JSON.stringify({result:'PASS',output,sha256:hash,sourceCommit:commit,sourceFiles:names.length,runtimeFiles:runtime.size,application:'Byte-identical to verified beta 1',secrets:'Recognized and private exact-key checks passed'}));
}finally{assert.ok(temporary.startsWith(resolve('release')+sep));rmSync(temporary,{recursive:true,force:true});}
