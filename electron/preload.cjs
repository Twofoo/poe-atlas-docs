const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const h = (_e, p) => cb(p);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  list: (kind) => ipcRenderer.invoke('store:list', kind),
  get: (kind, id) => ipcRenderer.invoke('store:get', kind, id),
  put: (kind, obj) => ipcRenderer.invoke('store:put', kind, obj),
  putSync: (kind, obj) => ipcRenderer.sendSync('store:put-sync', kind, obj),
  remove: (kind, id) => ipcRenderer.invoke('store:delete', kind, id),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  openFile: (opts) => ipcRenderer.invoke('file:open', opts),
  savePdf: (opts) => ipcRenderer.invoke('file:pdf', opts),
  openAtlasWindow: (treeId, profileId) => ipcRenderer.invoke('window:atlas', treeId, profileId),
  pendingLink: () => ipcRenderer.invoke('link:pending'),
  openExternal: (url) => ipcRenderer.invoke('shell:external', url),
  onStoreChanged: listen('store:changed'),
  onOpenLink: listen('open-link'),
});
