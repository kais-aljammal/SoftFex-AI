import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export type Completion = { type: 'agent-turn-complete'; cwd: string; 'thread-id'?: string; 'turn-id'?: string; taskContext?: string };
export function normalizeWorkspace(path: string) { const p = resolve(path).replace(/[\\/]+$/, ''); return process.platform === 'win32' ? p.toLowerCase() : p; }
export async function startBridge(directory: string, getWorkspace: () => string | undefined, accept: (event: Completion) => void) {
  const token = randomBytes(32).toString('hex');
  const seen = new Set<string>();
  const server: Server = createServer((req, res) => {
    const end = (status: number) => { res.writeHead(status); res.end(); };
    const auth = req.headers.authorization ?? '';
    const wanted = `Bearer ${token}`;
    if (req.method !== 'POST' || req.url !== '/codex-event' || req.headers.origin) { end(404); return; }
    if (Buffer.byteLength(auth) !== Buffer.byteLength(wanted) || !timingSafeEqual(Buffer.from(auth), Buffer.from(wanted))) { end(401); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { end(415); return; }
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 8192) { end(413); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => {
      if (size > 8192) return;
      try {
        const d = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (d.type !== 'agent-turn-complete' || typeof d.cwd !== 'string' || d.cwd.length > 2048 || !getWorkspace() || normalizeWorkspace(d.cwd) !== normalizeWorkspace(getWorkspace()!)) { end(422); return; }
        if (['thread-id','turn-id'].some(k => d[k] !== undefined && (typeof d[k] !== 'string' || d[k].length > 200))) { end(422); return; }
        if (d.taskContext !== undefined && (typeof d.taskContext !== 'string' || d.taskContext.length > 1600)) { end(422); return; }
        const id = d['thread-id'] && d['turn-id'] ? JSON.stringify([normalizeWorkspace(d.cwd),d['thread-id'],d['turn-id']]) : undefined;
        if (id && seen.has(id)) { end(204); return; }
        if (id) { if (seen.size >= 1024) seen.delete(seen.values().next().value!); seen.add(id); }
        accept({ type: d.type, cwd: d.cwd, 'thread-id': d['thread-id'], 'turn-id': d['turn-id'], taskContext: d.taskContext }); end(204);
      } catch { end(400); }
    });
    req.on('error', () => {});
  });
  server.headersTimeout = 2000; server.requestTimeout = 2000;
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => { server.removeListener('error', no); yes(); }); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Bridge unavailable');
  const descriptor = join(directory, 'bridge.json');
  await mkdir(directory, { recursive: true });
  await writeFile(descriptor, JSON.stringify({ host: '127.0.0.1', port: address.port, token }), { mode: 0o600 });
  return { port: address.port, token, async close() { await new Promise<void>(yes => server.close(() => yes())); await unlink(descriptor).catch(() => {}); } };
}
