const { contextBridge } = require('electron')

// Expose only a capability flag. Library data stays behind the guarded local API.
contextBridge.exposeInMainWorld('dealriftDesktop', Object.freeze({ isDesktop: true }))
