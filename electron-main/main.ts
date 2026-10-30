/**
 * Postmaster main process.
 * Security posture: context-isolated renderer, no node integration, sandboxed
 * preload, deny-all permission model, navigation + window-open restrictions,
 * CSP, single-instance, minimized IPC surface (see preload/ipc handlers).
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { HttpService } from './http/httpService'

import { DataStore } from './store/dataStore'
import { registerStoreIpc } from './ipc/storeIpc'
import { registerHttpIpc } from './ipc/httpIpc'
import { registerSystemIpc } from './ipc/systemIpc'
import { registerScriptIpc } from './ipc/scriptIpc'

const isDev = process.env.PM_DEV === '1'

// Crash-report cleanliness: no remote deps
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

let mainWindow: BrowserWindow | null = null
let dataStore: DataStore | null = null

const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    title: 'Postmaster',
    backgroundColor: '#1b1b1b',
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 14 },
    // taskbar + titlebar icon (original artwork in build/, MIT — see scripts/gen-icon.mjs)
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Navigation is restricted: no renderer-initiated external navigation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:5173')) return
    event.preventDefault()
  })

  // Permissions: deny all by default (notification etc. not needed)
  const allSession = mainWindow.webContents.session
  allSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(async () => {
  const dataDir = path.join(app.getPath('userData'), 'appstore')
  dataStore = new DataStore(dataDir)
  await dataStore.initialize()
  const httpService = new HttpService()

  registerStoreIpc(ipcMain, dataStore)
  registerHttpIpc(ipcMain, httpService)
  registerScriptIpc(ipcMain)
  registerSystemIpc(ipcMain, () => mainWindow)

  ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const w = BrowserWindow.getFocusedWindow()
    if (w) {
      if (w.isMaximized()) w.unmaximize()
      else w.maximize()
    }
  })
  ipcMain.handle('window:close', () => BrowserWindow.getFocusedWindow()?.close())
  ipcMain.handle('window:isMaximized', () => BrowserWindow.getFocusedWindow()?.isMaximized() ?? false)
  ipcMain.handle('window:setZoom', (_e, percent: unknown) => {
    const w = mainWindow
    if (!w) return null
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return null
    const factor = Math.min(2, Math.max(0.5, percent / 100))
    w.webContents.setZoomFactor(factor)
    return factor
  })

  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void dataStore?.shutdown()
})
