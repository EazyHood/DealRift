const { app, BrowserWindow, dialog, shell, Tray, Menu, Notification, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { isInternalAppUrl, isTrustedExternalUrl } = require('./security.cjs')

let mainWindow
let apiServer
let apiPort
let libraryService
let tray
let quitting = false
let closePending = false
let checking = false
let checkTimer
let notificationTimer
let interfaceLanguage = 'es'

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function ensureTray() {
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(appRoot(), 'build', 'icon.png'))
    tray = new Tray(icon.resize({ width: 24, height: 24 }))
    tray.on('double-click', showWindow)
  }
  const spanish = interfaceLanguage === 'es'
  tray.setToolTip(spanish ? 'DealRift · seguimiento de tu lista' : 'DealRift · watching your list')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: spanish ? 'Abrir DealRift' : 'Open DealRift', click: showWindow },
    { label: spanish ? 'Buscar actualizaciones' : 'Check for updates', click: () => { void shell.openExternal('https://github.com/EazyHood/DealRift/releases').catch(() => undefined) } },
    { type: 'separator' },
    { label: spanish ? 'Salir' : 'Quit', click: () => { quitting = true; app.quit() } },
  ]))
}

async function deliverNotifications() {
  if (!libraryService || !Notification.isSupported()) return
  const alerts = await libraryService.claimNotifications()
  if (!alerts.length) return
  const spanish = interfaceLanguage === 'es'
  const notification = new Notification({
    title: spanish ? `DealRift · ${alerts.length} ${alerts.length === 1 ? 'precio encontrado' : 'precios encontrados'}` : `DealRift · ${alerts.length} ${alerts.length === 1 ? 'price match' : 'price matches'}`,
    body: alerts.length === 1 ? alerts[0].message : `${alerts.slice(0, 3).map((alert) => alert.message).join('\n')}${alerts.length > 3 ? spanish ? '\nAbre tu biblioteca para ver todos.' : '\nOpen your library to see all matches.' : ''}`,
    icon: path.join(appRoot(), 'build', 'icon.png'),
  })
  notification.on('click', showWindow)
  notification.show()
}

async function checkWatchedGames() {
  if (checking || !libraryService) return
  checking = true
  try {
    const state = await libraryService.check()
    interfaceLanguage = state.settings['dealrift-language'] ?? 'en'
    if (tray) ensureTray()
    await deliverNotifications()
  } catch (error) {
    // A corrupt or temporarily unavailable library must never be overwritten.
    console.error('DealRift library check failed:', error instanceof Error ? error.message : String(error))
  } finally { checking = false }
}

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
  process.env.RADAR_USER_AGENT = process.env.RADAR_USER_AGENT ?? `DealRift/${app.getVersion()} (https://github.com/EazyHood/DealRift)`
  process.env.DEALRIFT_VERSION = app.getVersion()
  process.env.DEALRIFT_DESKTOP = '1'

  const { startRadarServer } = require(path.join(root, 'dist-server', 'index.cjs'))
  const started = await startRadarServer({
    host: '127.0.0.1',
    port: 0,
    staticDir: path.join(root, 'dist'),
  })

  apiServer = started.server
  libraryService = started.libraryService
  return started.port
}

async function createWindow() {
  const port = apiPort ?? await startInternalServer()
  apiPort = port

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
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#05070a',
    autoHideMenuBar: true,
    show: false,
    title: 'DealRift',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
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

  mainWindow.on('close', (event) => {
    if (quitting || !libraryService) return
    event.preventDefault()
    if (closePending) return
    closePending = true
    void libraryService.read().then((state) => {
      interfaceLanguage = state.settings['dealrift-language'] ?? 'en'
      if (state.settings['dealrift-background'] === 'true') {
        ensureTray()
        mainWindow.hide()
      } else {
        quitting = true
        app.quit()
      }
    }).catch(() => {
      quitting = true
      app.quit()
    }).finally(() => { closePending = false })
  })

  await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  if (!checkTimer) {
    checkTimer = setInterval(() => { void checkWatchedGames() }, 5 * 60 * 1000)
    notificationTimer = setInterval(() => { void deliverNotifications().catch(() => undefined) }, 30 * 1000)
    void checkWatchedGames()
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
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
  quitting = true
  clearInterval(checkTimer)
  clearInterval(notificationTimer)
  tray?.destroy()
  apiServer?.close()
})
