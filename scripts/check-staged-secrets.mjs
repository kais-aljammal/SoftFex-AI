import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20_000_000});
const files=git('ls-files','--cached','-z').split('\0').filter(Boolean);
const forbidden=/(^|\/)(?:\.env(?:\..*)?|node_modules|dist|out|build|release|artifacts|\.softfex-local|\.aws|\.codex|\.agents|id_rsa|id_ed25519|auth\.json|credentials[^/]*\.json|secrets\.[^/]+)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore|exe|msi)$/i;
const keyPattern=/\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ANTHROPIC_API_KEY|DEEPGRAM_API_KEY)\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/;
let failed=false;
for(const file of files){
 if(file!=='.env.example'&&forbidden.test(file)){console.error(`Blocked sensitive or generated file: ${file}`);failed=true;continue;}
 const content=git('show',`:${file}`);
 if(keyPattern.test(content)){console.error(`Blocked possible credential in: ${file}`);failed=true;}
}
if(failed)process.exit(1);
console.log(`PASS: ${files.length} staged files checked; no prohibited files or recognizable credentials found.`);
