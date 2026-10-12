import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startBridge } from '../src/main/bridge-server';
test('bridge authenticates, routes only matching workspaces and deduplicates completion events', async () => {
  const directory = await mkdtemp(join(tmpdir(),'softfex-bridge-')); let count = 0;
  const bridge = await startBridge(directory, () => process.cwd(), () => { count++; });
  try {
    const send = (body: unknown, token = bridge.token) => fetch(`http://127.0.0.1:${bridge.port}/codex-event`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type':'application/json' }, body: JSON.stringify(body) });
    const event = { type:'agent-turn-complete',cwd:process.cwd(),'thread-id':'test','turn-id':'one' };
    assert.equal((await send(event,'bad')).status,401);
    assert.equal((await send({...event,cwd:tmpdir()})).status,422);
    assert.equal((await send({type:'agent-turn-complete'})).status,422);
    assert.equal((await send({...event,type:'bad'})).status,422);
    assert.equal((await send(event)).status,204);
    assert.equal((await send(event)).status,204); assert.equal(count,1);
    assert.equal((await send({...event,'turn-id':'two'})).status,204); assert.equal(count,2);
  } finally { await bridge.close(); await rm(directory,{recursive:true,force:true}); }
});
test('relay exits cleanly when app descriptor is missing', () => {
  const result = spawnSync(process.execPath, ['scripts/softfex-notify.cjs', JSON.stringify({type:'agent-turn-complete',cwd:process.cwd()})], { env:{...process.env,SOFTFEX_BRIDGE_DESCRIPTOR:join(tmpdir(),'missing-softfex-descriptor.json')},timeout:2000 });
  assert.equal(result.status,0); assert.equal(result.stdout.toString(),''); assert.equal(result.stderr.toString(),'');
});
