import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import type { ProviderId, SendRequest, SettingsPatch } from '../shared/types'
import { runTurn } from './agent'
import { listModels, verifyProvider } from './verify'
import * as store from './store'

let win: BrowserWindow | null = null
const controllers = new Map<string, AbortController>()
const approvals = new Map<string, { conversationId: string; resolve: (value: boolean) => void }>()

function emit(event: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send('agent:event', event)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 940,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win?.show())

  win.on('maximize', () => emit({ type: 'window-state', maximized: true }))
  win.on('unmaximize', () => emit({ type: 'window-state', maximized: false }))
  win.on('closed', () => {
    win = null
    for (const [, pending] of approvals) pending.resolve(false)
    approvals.clear()
    for (const [, controller] of controllers) controller.abort()
    controllers.clear()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => store.publicSettings())
  ipcMain.handle('settings:save', (_event, patch: SettingsPatch) => store.saveSettings(patch))
  ipcMain.handle('settings:set-key', (_event, provider: ProviderId, key: string) => store.setApiKey(provider, key))
  ipcMain.handle('settings:test', (_event, provider: ProviderId) => verifyProvider(provider))
  ipcMain.handle('settings:models', (_event, provider: ProviderId) => listModels(provider))
  ipcMain.handle('settings:pick-folder', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the agent workspace',
      defaultPath: store.workspace(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })
  ipcMain.handle('shell:open-workspace', async () => {
    await shell.openPath(store.workspace())
  })
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('conversations:list', () => store.listConversations())
  ipcMain.handle('conversations:get', (_event, id: string) => store.getConversation(id))
  ipcMain.handle('conversations:create', () =>
    store.createConversation(store.activeProvider(), store.activeLevel())
  )
  ipcMain.handle('conversations:delete', (_event, id: string) => {
    controllers.get(id)?.abort()
    store.deleteConversation(id)
    return store.listConversations()
  })
  ipcMain.handle('conversations:rename', (_event, id: string, title: string) => {
    store.renameConversation(id, title)
    return store.listConversations()
  })

  ipcMain.on('agent:send', (_event, request: SendRequest) => {
    const existing = controllers.get(request.conversationId)
    if (existing) return
    const controller = new AbortController()
    controllers.set(request.conversationId, controller)

    void runTurn({
      conversationId: request.conversationId,
      text: request.text,
      agentMode: request.agentMode,
      attachments: request.attachments ?? [],
      signal: controller.signal,
      emit,
      requestApproval: (call) =>
        new Promise<boolean>((resolve) => {
          approvals.set(call.id, { conversationId: request.conversationId, resolve })
        })
    }).finally(() => {
      controllers.delete(request.conversationId)
    })
  })

  ipcMain.on('agent:abort', (_event, conversationId: string) => {
    controllers.get(conversationId)?.abort()
    for (const [callId, pending] of approvals) {
      if (pending.conversationId === conversationId) {
        pending.resolve(false)
        approvals.delete(callId)
      }
    }
  })

  ipcMain.on('agent:approve', (_event, payload: { callId: string; approved: boolean }) => {
    const pending = approvals.get(payload.callId)
    if (!pending) return
    approvals.delete(payload.callId)
    pending.resolve(payload.approved)
  })

  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', () => win?.close())
}

app.setAppUserModelId('com.sonekks.chat')

// The product was renamed from "Sonekk"; keep the original data folder so existing
// installs keep their settings, encrypted keys and conversation history.
app.setPath('userData', join(app.getPath('appData'), 'Sonekk'))

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    store.initStore()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
