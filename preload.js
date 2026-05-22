const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setApiKey: (key) => ipcRenderer.invoke('settings:setKey', key),
  moduleState: (moduleId) => ipcRenderer.invoke('module:state', moduleId),
  addPdf: (moduleId, filePath, filename) =>
    ipcRenderer.invoke('module:addPdf', { moduleId, filePath, filename }),
  removeMaterial: (moduleId, materialId) =>
    ipcRenderer.invoke('module:removeMaterial', { moduleId, materialId }),
  clearHistory: (moduleId) => ipcRenderer.invoke('module:clearHistory', moduleId),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  sendChat: (payload) => ipcRenderer.send('chat:send', payload),
  onChatDelta: (cb) => ipcRenderer.on('chat:delta', (_e, t) => cb(t)),
  onChatDone: (cb) => ipcRenderer.on('chat:done', (_e, info) => cb(info)),
  onChatError: (cb) => ipcRenderer.on('chat:error', (_e, err) => cb(err)),
});
