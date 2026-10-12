import { contextBridge, ipcRenderer } from 'electron';
import type { SoftFexAPI, AppState } from '../shared/types';
const api: SoftFexAPI = {
  getState: () => ipcRenderer.invoke('softfex:getState'),
  configureCredential: provider => ipcRenderer.invoke('softfex:configureCredential',provider),
  onStateChange: callback => { const listener = (_e: unknown, state: AppState) => callback(state); ipcRenderer.on('softfex:state', listener); return () => ipcRenderer.removeListener('softfex:state', listener); },
  setWindowMode: mode => ipcRenderer.invoke('softfex:setWindowMode', mode),
  selectWorkspace: () => ipcRenderer.invoke('softfex:selectWorkspace'),
  reviewNow: () => ipcRenderer.invoke('softfex:reviewNow'),
  openFinding: id => ipcRenderer.invoke('softfex:openFinding', id),
  getFixPrompt: id => ipcRenderer.invoke('softfex:getFixPrompt', id),
  copyPrompt: id => ipcRenderer.invoke('softfex:copyPrompt', id),
  setMute: value => ipcRenderer.invoke('softfex:setMute', value),
  setAiReviewEnabled: value => ipcRenderer.invoke('softfex:setAiReviewEnabled', value),
  requestSpeech: request => ipcRenderer.invoke('softfex:requestSpeech', request),
  stopSpeech: () => ipcRenderer.invoke('softfex:stopSpeech'),
  quit: () => ipcRenderer.invoke('softfex:quit'),
};
contextBridge.exposeInMainWorld('softfex', api);
