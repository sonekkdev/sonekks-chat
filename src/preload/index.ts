import { contextBridge, ipcRenderer } from 'electron'
import type { SonekkApi, AgentStreamEvent } from '../shared/api'

const api: SonekkApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    setKey: (provider, key) => ipcRenderer.invoke('settings:set-key', provider, key),
    test: (provider) => ipcRenderer.invoke('settings:test', provider),
    models: (provider) => ipcRenderer.invoke('settings:models', provider),
    pickFolder: () => ipcRenderer.invoke('settings:pick-folder')
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id) => ipcRenderer.invoke('conversations:get', id),
    create: () => ipcRenderer.invoke('conversations:create'),
    remove: (id) => ipcRenderer.invoke('conversations:delete', id),
    rename: (id, title) => ipcRenderer.invoke('conversations:rename', id, title)
  },
  agent: {
    send: (request) => ipcRenderer.send('agent:send', request),
    abort: (conversationId) => ipcRenderer.send('agent:abort', conversationId),
    approve: (callId, approved) => ipcRenderer.send('agent:approve', { callId, approved }),
    onEvent: (handler) => {
      const listener = (_event: unknown, payload: AgentStreamEvent): void => handler(payload)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    }
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close')
  },
  shell: {
    openWorkspace: () => ipcRenderer.invoke('shell:open-workspace'),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  }
}

contextBridge.exposeInMainWorld('sonekk', api)
