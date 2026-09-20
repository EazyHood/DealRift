const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')

const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)) }

async function desktopFixture(background) {
  const windows = [], trays = [], notifications = [], timers = [], opened = []
  const state = { settings: { 'dealrift-background': String(background), 'dealrift-language': 'en' } }
  let checks = 0, heldCheck, pendingAlerts = []
  const app = new EventEmitter()
  Object.assign(app, {
    isPackaged: false, quitCount: 0, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: () => 'C:/mock-user-data', getVersion: () => '1.2.0',
    quit() { this.quitCount += 1; this.emit('before-quit') },
  })
  class BrowserWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.visible = false; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler }; windows.push(this) }
    async loadURL(url) { this.url = url; this.emit('ready-to-show') }
    show() { this.visible = true }
    hide() { this.visible = false }
    focus() { this.focused = true }
    isDestroyed() { return false }
    isMinimized() { return false }
    static getAllWindows() { return windows }
  }
  class Tray extends EventEmitter {
    constructor() { super(); trays.push(this) }
    setToolTip(value) { this.tooltip = value }
    setContextMenu(menu) { this.menu = menu }
    destroy() { this.destroyed = true }
  }
  class Notification extends EventEmitter {
    constructor(options) { super(); this.options = options; notifications.push(this) }
    show() { this.shown = true }
    static isSupported() { return true }
  }
  const service = {
    read: async () => state,
    check: async () => { checks += 1; if (heldCheck) await heldCheck; return state },
    claimNotifications: async () => { const alerts = pendingAlerts; pendingAlerts = []; return alerts },
  }
  const electron = { app, BrowserWindow, Tray, Notification, Menu: { buildFromTemplate: (menu) => menu }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, shell: { openExternal: async (url) => { opened.push(url) } }, dialog: { showErrorBox: () => assert.fail('Unexpected startup error'), showMessageBox: async () => ({}) } }
  let serverCloses = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), {
    require: (name) => name === 'electron' ? electron : name.endsWith('dist-server/index.cjs') || name.endsWith('dist-server\\index.cjs') ? { startRadarServer: async () => ({ server: { close: () => { serverCloses += 1 } }, port: 49123, libraryService: service }) } : name === './security.cjs' ? require('./security.cjs') : require(name),
    __dirname, process: { env: {}, platform: 'win32' }, console,
    setInterval: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer },
    clearInterval: (timer) => { if (timer) timer.cleared = true },
  }, { filename: 'electron/main.cjs' })
  await settle()
  return { app, state, windows, trays, timers, opened, notifications, checks: () => checks, serverCloses: () => serverCloses, hold: (promise) => { heldCheck = promise }, alert: (message) => { pendingAlerts.push({ message }) } }
}

test('desktop opt-in close hides in tray, menu reopens, Quit stops the server and timers', async () => {
  const fixture = await desktopFixture(true)
  const window = fixture.windows[0]
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  assert.equal(window.options.webPreferences.sandbox, true)
  assert.match(window.options.webPreferences.preload, /preload\.cjs$/)
  let prevented = false
  window.emit('close', { preventDefault: () => { prevented = true } })
  await settle()
  assert.equal(prevented, true)
  assert.equal(window.visible, false)
  assert.equal(fixture.app.quitCount, 0)
  const tray = fixture.trays[0]
  tray.menu[0].click()
  assert.equal(window.visible, true)
  tray.menu[1].click()
  await settle()
  assert.equal(fixture.opened[0], 'https://github.com/EazyHood/DealRift/releases')
  tray.menu.at(-1).click()
  assert.equal(fixture.app.quitCount, 1)
  assert.equal(fixture.serverCloses(), 1)
  assert.ok(fixture.timers.every((timer) => timer.cleared))
})

test('desktop close without background opt-in exits instead of leaving a process running', async () => {
  const fixture = await desktopFixture(false)
  fixture.windows[0].emit('close', { preventDefault() {} })
  await settle()
  assert.equal(fixture.app.quitCount, 1)
  assert.equal(fixture.trays.length, 0)
})

test('desktop five-minute checks do not overlap and multiple matches use one grouped notification', async () => {
  const fixture = await desktopFixture(true)
  const timer = fixture.timers.find((entry) => entry.delay === 5 * 60 * 1000)
  assert.ok(timer)
  let release
  fixture.hold(new Promise((resolve) => { release = resolve }))
  timer.callback()
  timer.callback()
  await settle()
  assert.equal(fixture.checks(), 2, 'one startup check and one interval check')
  fixture.alert('Alpha $10')
  fixture.alert('Beta $8')
  release()
  await settle()
  assert.equal(fixture.notifications.length, 1)
  assert.match(fixture.notifications[0].options.body, /Alpha \$10/)
  assert.match(fixture.notifications[0].options.body, /Beta \$8/)
})
