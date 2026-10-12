import {mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const mode=process.argv[2]||'safe';if(!['safe','unsafe'].includes(mode))throw new Error('Use safe or unsafe.');
const root=resolve('.softfex-local/demo');await mkdir(join(root,'src'),{recursive:true});
await writeFile(join(root,'src/auth.ts'),await readFile(`tests/fixtures/${mode==='safe'?'safe':'vulnerable'}-auth.ts`,'utf8'));
console.log(`Prepared controlled ${mode} source fixture: ${root}`);
