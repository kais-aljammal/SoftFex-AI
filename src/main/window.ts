import { BrowserWindow, screen, systemPreferences } from 'electron';
import { join } from 'node:path';
import type {WindowMode} from '../shared/types';
export function createNotch() {
  const win = new BrowserWindow({
    width: 220, height: 40, frame: false, transparent: process.platform!=='win32', resizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: process.platform==='win32'?'#07090D':'#00000000',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, respond) => respond(false));
  void positionNotch(win, 'collapsed', false);
  // A shaped transparent HWND can suppress the first paint on Windows. Show after
  // document load, then apply the region; never wait on that paint to show it.
  win.webContents.once('did-finish-load', () => {win.showInactive();void positionNotch(win,'collapsed',false);});
  void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
const transitions=new WeakMap<BrowserWindow,{timer:ReturnType<typeof setInterval>;finish:()=>void}>();
export function positionNotch(win: BrowserWindow, mode: WindowMode, animate=true):Promise<void> {
  const previous=transitions.get(win);if(previous){clearInterval(previous.timer);previous.finish();transitions.delete(win);}
  const area = screen.getPrimaryDisplay().workArea;
  const sizes:Record<WindowMode,[number,number]>={collapsed:[220,40],changes:[264,44],reviewing:[264,44],speaking:[290,48],warning:[366,108],report:[420,440],detail:[440,540]};
  const width = Math.min(sizes[mode][0], area.width);
  const height = Math.min(sizes[mode][1], area.height-16);
  const target={x:Math.round(area.x+(area.width-width)/2),y:area.y+8,width,height};
  function apply(bounds:Electron.Rectangle){
   win.setBounds(bounds);
   if(process.platform==='win32'&&win.isVisible()){
    const bounds=win.getBounds();const radius=Math.min(bounds.height/2,mode==='report'||mode==='detail'?28:bounds.height/2);
    const rects=[];for(let y=0;y<bounds.height;y++){const distance=Math.max(0,radius-y-.5,y+.5-(bounds.height-radius));const inset=distance>0?Math.ceil(radius-Math.sqrt(Math.max(0,radius*radius-distance*distance))):0;rects.push({x:inset,y,width:Math.max(1,bounds.width-2*inset),height:1});}
    try{win.setShape(rects);}catch{/* Tight native bounds remain the fallback. */}
   }
  }
  const from=win.getBounds();
  if(!animate||systemPreferences.getAnimationSettings().prefersReducedMotion||!win.isVisible()||Object.keys(target).every(k=>from[k as keyof Electron.Rectangle]===target[k as keyof Electron.Rectangle])){apply(target);return Promise.resolve();}
  return new Promise(finish=>{
    const started=Date.now();
    const timer=setInterval(()=>{
      if(win.isDestroyed()){clearInterval(timer);transitions.delete(win);finish();return;}
      const progress=Math.min(1,(Date.now()-started)/240);const ease=1-Math.pow(1-progress,4);
      apply({x:Math.round(from.x+(target.x-from.x)*ease),y:target.y,width:Math.round(from.width+(width-from.width)*ease),height:Math.round(from.height+(height-from.height)*ease)});
      if(progress===1){clearInterval(timer);transitions.delete(win);finish();}
    },16);
    transitions.set(win,{timer,finish});
  });
}
