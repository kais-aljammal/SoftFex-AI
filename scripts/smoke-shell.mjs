import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const app = await electron.launch({ executablePath: electronPath, args: ['.'] });
try {
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /SoftFex/ }).click();
  await page.getByRole('heading', { name:'Your code. A second look.' }).waitFor();
  let bounds = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(Math.abs(bounds.width-420)<=1); assert.ok(Math.abs(bounds.height-440)<=1);
  await page.screenshot({ path:'artifacts/shell-expanded.png' });
  await page.getByRole('button',{name:'Collapse',exact:true}).click();
  bounds = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(Math.abs(bounds.width-220)<=1); assert.ok(Math.abs(bounds.height-40)<=1);
  const isolation = await page.evaluate(() => ({ node: typeof window.require, bridge: typeof window.softfex.getState }));
  assert.equal(isolation.node,'undefined'); assert.equal(isolation.bridge,'function');
  assert.deepEqual(errors,[]); console.log('PASS: real Electron renderer, collapse/expand bounds, isolated preload, no renderer errors.');
} finally { await app.close(); }
