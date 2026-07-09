const { app, BrowserWindow, dialog, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { isInternalAppUrl, isTrustedExternalUrl } = require('./security.cjs')

let mainWindow
let apiServer

function reportStartupError(error) {
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  try {
    const logDir = app.getPath('logs')
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(path.join(logDir, 'startup-error.log'), `[${new Date().toISOString()}]\n${message}\n\n`, 'utf8')
  } catch {
    // The dialog below remains available if the log folder cannot be written.
  }
  dialog.showErrorBox('DealRift no pudo iniciar', message)
}

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, '..')
}

async function startInternalServer() {
  const root = appRoot()
  process.env.DEALRIFT_DATA_DIR = path.join(app.getPath('userData'), 'data')
  process.env.RADAR_USER_AGENT = process.env.RADAR_USER_AGENT ?? 'DealRiftDesktop/1.0 (Windows app)'
  process.env.DEALRIFT_VERSION = app.getVersion()

  const { startRadarServer } = require(path.join(root, 'dist-server', 'index.cjs'))
  const started = await startRadarServer({
    host: '127.0.0.1',
    port: 0,
    staticDir: path.join(root, 'dist'),
  })

  apiServer = started.server
  return started.port
}

async function createWindow() {
  const port = await startInternalServer()

  const openTrustedExternalUrl = async (url) => {
    if (!isTrustedExternalUrl(url)) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Enlace bloqueado',
        message: 'DealRift ha bloqueado un destino que no pertenece a una tienda compatible.',
        detail: url,
      })
      return
    }

    try {
      await shell.openExternal(url)
    } catch (error) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'No se pudo abrir el enlace',
        message: 'La tienda no pudo abrirse en el navegador.',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#05070a',
    autoHideMenuBar: true,
    show: false,
    title: 'DealRift',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternalAppUrl(url, port)) {
      void openTrustedExternalUrl(url)
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalAppUrl(url, port)) return
    event.preventDefault()
    void openTrustedExternalUrl(url)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  await mainWindow.loadURL(`http://127.0.0.1:${port}`)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(createWindow).catch((error) => {
    reportStartupError(error)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      reportStartupError(error)
    })
  }
})

app.on('before-quit', () => {
  apiServer?.close()
})
