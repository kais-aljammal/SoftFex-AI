import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type {WindowMode} from '../shared/types';
export function createNotch() {
  const win = new BrowserWindow({
    width: 220, height: 40, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, respond) => respond(false));
  positionNotch(win, 'collapsed');
  win.once('ready-to-show', () => win.showInactive());
  void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
export function positionNotch(win: BrowserWindow, mode: WindowMode) {
  const area = screen.getPrimaryDisplay().workArea;
  const sizes:Record<WindowMode,[number,number]>={collapsed:[220,40],changes:[264,44],reviewing:[264,44],speaking:[290,48],warning:[366,108],report:[420,440],detail:[440,540]};
  const width = Math.min(sizes[mode][0], area.width);
  const height = Math.min(sizes[mode][1], area.height-16);
  win.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y+8, width, height });
  if(process.platform==='win32'){
    const bounds=win.getBounds();const radius=Math.min(height/2,mode==='report'||mode==='detail'?28:height/2);
    const rects=[];for(let y=0;y<bounds.height;y++){const distance=Math.max(0,radius-y-.5,y+.5-(bounds.height-radius));const inset=distance>0?Math.ceil(radius-Math.sqrt(Math.max(0,radius*radius-distance*distance))):0;rects.push({x:inset,y,width:Math.max(1,bounds.width-2*inset),height:1});}
    try{win.setShape(rects);}catch{/* Tight native bounds remain the fallback. */}
  }
}
