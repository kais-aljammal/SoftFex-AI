// Codex appends a single JSON argument. Errors must never break its turn.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const raw = process.argv.at(-1);
try {
  const previousPath = path.join(__dirname, '../.softfex-local/previous-notify.json');
  if (fs.existsSync(previousPath)) {
    const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
    if (Array.isArray(previous) && previous.length && previous.every(a => typeof a === 'string')) {
      const child = spawn(previous[0], [...previous.slice(1), raw], { shell: false, windowsHide: true, stdio: 'ignore' });
      child.on('error', () => {}); child.unref();
    }
  }
  if (typeof raw !== 'string' || raw.length > 1_000_000) process.exit(0);
  const event = JSON.parse(raw);
  if (event.type !== 'agent-turn-complete' || typeof event.cwd !== 'string' || event.cwd.length > 2048) process.exit(0);
  const descriptorPath = process.env.SOFTFEX_BRIDGE_DESCRIPTOR || path.join(process.env.APPDATA || '', 'SoftFex AI', 'bridge.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  if (descriptor.host !== '127.0.0.1' || !Number.isInteger(descriptor.port) || descriptor.port < 1024 || descriptor.port > 65535 || !/^[a-f0-9]{64}$/.test(descriptor.token)) process.exit(0);
  // Verified installed CLI shape: input-messages is an array of task strings.
  // Treat it as untrusted contextual data. Main validates/redacts before review.
  const messages=event['input-messages'];
  const taskContext=Array.isArray(messages)&&messages.every(item=>typeof item==='string')?messages.at(-1)?.slice(0,1600):undefined;
  const data = JSON.stringify({ type: event.type, cwd: event.cwd, 'thread-id': typeof event['thread-id'] === 'string' ? event['thread-id'].slice(0,200) : undefined, 'turn-id': typeof event['turn-id'] === 'string' ? event['turn-id'].slice(0,200) : undefined, taskContext });
  const req = http.request({ hostname: '127.0.0.1', port: descriptor.port, path: '/codex-event', method: 'POST', headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: 800 }, res => res.resume());
  req.on('timeout', () => req.destroy()); req.on('error', () => {}); req.end(data);
} catch { /* App closed, invalid payload or descriptor: exit cleanly. */ }
