import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const app = await electron.launch({ executablePath: electronPath, args: ['.'] });
try {
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function geometry(){
    const native=await app.evaluate(({BrowserWindow,screen})=>{const window=BrowserWindow.getAllWindows()[0],bounds=window.getBounds();return {bounds,content:window.getContentBounds(),workArea:screen.getDisplayMatching(bounds).workArea,alwaysOnTop:window.isAlwaysOnTop(),visible:window.isVisible()};});
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(native.bounds[key]-native.content[key])<=1,`Opaque frameless window must not add an outer non-client rectangle (${key}).`);
    assert.equal(native.alwaysOnTop,true);assert.equal(native.visible,true);
    assert.ok(Math.abs(native.bounds.x+native.bounds.width/2-native.workArea.x-native.workArea.width/2)<=2,'Island must remain horizontally centered in its display work area.');
    assert.ok(Math.abs(native.bounds.y-native.workArea.y-8)<=1,'Island must remain at the top work-area inset.');
    assert.ok(native.bounds.x>=native.workArea.x&&native.bounds.y>=native.workArea.y);assert.ok(native.bounds.x+native.bounds.width<=native.workArea.x+native.workArea.width+1);assert.ok(native.bounds.y+native.bounds.height<=native.workArea.y+native.workArea.height+1);
    const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth-innerWidth,height:document.documentElement.scrollHeight-innerHeight}));
    assert.ok(overflow.width<=1&&overflow.height<=1,'Document must not overflow the shaped native window; scrolling belongs inside content.');
    return native.bounds;
  }
  await page.getByRole('button', { name: /SoftFex/ }).click();
  await page.getByRole('heading', { name:'Your code. A second look.' }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true,'Native window must actually be visible, not only render offscreen.');
  let bounds = await geometry();
  assert.ok(Math.abs(bounds.width-420)<=1); assert.ok(Math.abs(bounds.height-440)<=1);
  await page.screenshot({ path:'artifacts/shell-expanded.png' });
  await page.getByRole('button',{name:'Collapse',exact:true}).click();
  await page.waitForTimeout(300);
  bounds = await geometry();
  assert.ok(Math.abs(bounds.width-220)<=1); assert.ok(Math.abs(bounds.height-40)<=1);
  const isolation = await page.evaluate(() => ({ node: typeof window.require, bridge: typeof window.softfex.getState }));
  assert.equal(isolation.node,'undefined'); assert.equal(isolation.bridge,'function');
  assert.deepEqual(errors,[]); console.log('PASS: real Electron renderer, collapse/expand bounds, equal native content/outer bounds, top-center always-on-top placement, no document overflow, isolated preload and no renderer errors. Native pointer hit testing is checked separately.');
} finally { await app.close(); }
