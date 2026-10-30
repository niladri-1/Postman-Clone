/**
 * Preload: the ONLY privileged bridge. Exposes a small, validated API via
 * contextBridge. No raw IPC pass-through, no node primitives.
 */
import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const allowed = new Set([
    'app:info',
    'store:loadAll',
    'store:save',
    'http:send',
    'http:cancel',
    'script:run',
    'dialog:importFile',
    'dialog:exportFile',
    'cookies:list',
    'cookies:clear',
    'shell:openExternal',
    'window:minimize',
    'window:maximize',
    'window:close',
    'window:isMaximized',
    'window:setZoom',
  ])
  if (!allowed.has(channel)) {
    return Promise.reject(new Error('channel not allowed: ' + channel))
  }
  return ipcRenderer.invoke(channel, ...args)
}

const api = {
  loadStores: () => invoke('store:loadAll'),
  saveStore: (name: string, data: unknown) => invoke('store:save', name, data),
  sendHttp: (payload: unknown) => invoke('http:send', payload),
  cancelHttp: (requestId: string) => invoke('http:cancel', requestId),
  runScript: (payload: unknown) => invoke('script:run', payload),
  appInfo: () => invoke('app:info'),
  importFile: () => invoke('dialog:importFile'),
  exportFile: (name: string, content: string) => invoke('dialog:exportFile', name, content),
  listCookies: () => invoke('cookies:list'),
  clearCookies: (domain?: string) => invoke('cookies:clear', domain ?? null),
  openExternal: (url: string) => invoke('shell:openExternal', url),
  minimize: () => invoke('window:minimize'),
  maximize: () => invoke('window:maximize'),
  close: () => invoke('window:close'),
  isMaximized: () => invoke('window:isMaximized'),
  /** percent 50–200; validated + clamped in the main process */
  setZoom: (percent: number) => invoke('window:setZoom', percent),
}

contextBridge.exposeInMainWorld('postmaster', api)

export type PostmasterApi = typeof api
