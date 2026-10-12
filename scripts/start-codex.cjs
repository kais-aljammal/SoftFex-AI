const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
// Native argument arrays preserve TOML quoting on Windows; no shell interpolation.
const inspected=spawnSync('python',['-c','import os,pathlib,tomllib,json; p=pathlib.Path(os.getenv("CODEX_HOME") or pathlib.Path.home()/".codex")/"config.toml"; print(json.dumps(tomllib.loads(p.read_text(encoding="utf-8-sig")).get("notify",[])))'],{encoding:'utf8',windowsHide:true});
let previous;
try{if(inspected.status!==0)throw new Error();previous=JSON.parse(inspected.stdout);if(!Array.isArray(previous)||!previous.every(x=>typeof x==='string'))throw new Error();}
catch{console.error('Could not inspect existing notify. Global settings are unchanged.');process.exit(1);}
const local=path.join(__dirname,'../.softfex-local');fs.mkdirSync(local,{recursive:true});fs.writeFileSync(path.join(local,'previous-notify.json'),JSON.stringify(previous));
const found=spawnSync('where.exe',['codex.exe'],{encoding:'utf8',windowsHide:true});
const executable=found.stdout?.trim().split(/\r?\n/).find(p=>fs.existsSync(p));
if(!executable){console.error('Codex CLI executable not found.');process.exit(1);}
const override=`notify=${JSON.stringify([process.execPath,path.join(__dirname,'softfex-notify.cjs')])}`;
const child=spawn(executable,[...process.argv.slice(2),'-c',override],{shell:false,stdio:'inherit',windowsHide:false});
child.on('error',()=>{console.error('Codex CLI could not launch.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
