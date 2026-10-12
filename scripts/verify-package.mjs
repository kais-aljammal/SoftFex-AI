import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {listPackage,extractFile} from '@electron/asar';
let extraction;
try {
let directory=join('release','win-unpacked','resources');
if(process.argv.includes('--portable')||process.argv.includes('--zip')){
 const suffix=process.argv.includes('--zip')?'zip':'exe';
 const artifact=readdirSync('release').find(name=>name.startsWith('SoftFex-AI-')&&name.endsWith(`-windows-x64.${suffix}`));assert.ok(artifact,'Release artifact missing');
 const listing=execFileSync(join('node_modules','7zip-bin','win','x64','7za.exe'),['l','-slt',join('release',artifact)],{encoding:'utf8',maxBuffer:1_000_000});
 const entries=listing.split(/\r?\n/).filter(line=>line.startsWith('Path = ')).slice(1).map(line=>line.slice(7).replaceAll('\\','/'));
 assert.equal(entries.some(path=>/(^|\/)(?:\.env(?:\.|$)|credentials\.env|\.softfex-local|artifacts|\.git|src|tests)(?:\/|$)/i.test(path)),false,'Private/development entry in release archive');
 extraction=mkdtempSync(join(tmpdir(),'softfex-package-audit-'));
 execFileSync(join('node_modules','7zip-bin','win','x64','7za.exe'),['x',join('release',artifact),'resources/*',`-o${extraction}`,'-y','-bso0','-bsp0','-bse0'],{stdio:'ignore',timeout:60000});
 directory=join(extraction,'resources');
}
const archive=join(directory,'app.asar');
assert.ok(existsSync(archive),'Packaged app archive missing');
const files=listPackage(archive).map(path=>path.replaceAll('\\','/'));
const denied=files.filter(path=>/(^|\/)(?:\.env(?:\.|$)|credentials\.env|\.softfex-local|artifacts|\.git)(?:\/|$)/i.test(path)||/\.map$/i.test(path)||/^\/(?:src|tests|scripts)\//.test(path));
assert.deepEqual(denied,[],'Private/development files in package');
for(const entry of ['/dist/main/index.cjs','/dist/preload/index.cjs','/dist/renderer/index.html'])assert.ok(files.includes(entry),'Runtime file missing');
for(const entry of ['dist/main/index.cjs','dist/preload/index.cjs','dist/renderer/index.html'])assert.ok(extractFile(archive,join(...entry.split('/'))).equals(readFileSync(entry)),`Stale compiled runtime: ${entry}`);
assert.ok(files.includes('/node_modules/@anthropic-ai/sdk/lib/credentials/types.js'),'Anthropic runtime credential-types module missing');
assert.deepEqual(readdirSync(join(directory,'helpers')).sort(),['configure-key.ps1','launch-key-setup.ps1','softfex-notify.cjs','start-codex.cjs']);
for(const name of readdirSync(join(directory,'helpers')))assert.ok(readFileSync(join(directory,'helpers',name)).equals(readFileSync(join('scripts',name))),`Stale packaged helper: ${name}`);
// Compare privately in memory. Only pass/fail leaves this process.
const buffers=[readFileSync(archive),...readdirSync(join(directory,'helpers')).map(name=>readFileSync(join(directory,'helpers',name)))];
for(const bytes of buffers)assert.equal(/sk-ant-[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8')),false,'Recognized Anthropic key pattern in package');
if(existsSync('.env'))for(const line of readFileSync('.env','utf8').split(/\r?\n/)){
 const match=line.match(/^(?:ANTHROPIC_API_KEY|DEEPGRAM_API_KEY)=(.*)$/);const key=match?.[1].trim().replace(/^(["'])(.*)\1$/,'$2');
 if(key)for(const bytes of buffers)assert.equal(bytes.includes(Buffer.from(key)),false,'Configured credential found in package');
}
console.log(`PASS: ${extraction?'extracted release artifact':'unpacked app'} allowlist, current runtime helpers, recognized/private configured-credential scan (${files.length} archive entries).`);
} finally {if(extraction)rmSync(extraction,{recursive:true,force:true});}
