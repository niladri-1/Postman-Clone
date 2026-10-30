import type { IpcMain } from 'electron'
import type { DataStore } from '../store/dataStore'
import { decryptSecretsForLoad, encryptSecretsForSave } from '../store/secrets'
import type { Environment, EnvVar } from '../../shared/models'

const STORE_NAMES = ['collections', 'environments', 'history', 'settings', 'tabs'] as const
type StoreName = (typeof STORE_NAMES)[number]

export function registerStoreIpc(ipcMain: IpcMain, dataStore: DataStore): void {
  ipcMain.handle('store:loadAll', () => {
    const envsRaw = dataStore.get('environments', { environments: [], globals: [] })
    return {
      collections: dataStore.get('collections', []),
      environments: decryptSecretsForLoad(envsRaw),
      history: dataStore.get('history', []),
      settings: dataStore.get('settings', {}),
      tabs: dataStore.get('tabs', { tabs: [] }),
    }
  })

  ipcMain.handle('store:save', (_e, name: unknown, data: unknown) => {
    if (typeof name !== 'string' || !(STORE_NAMES as readonly string[]).includes(name)) {
      return { ok: false, error: 'invalid store name' }
    }
    if (name === 'environments' && isEnvBag(data)) {
      data = encryptSecretsForSave(data)
    }
    dataStore.set(name as StoreName, data)
    return { ok: true }
  })
}

function isEnvBag(v: unknown): v is { environments: Environment[]; globals: EnvVar[] } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as { environments?: unknown; globals?: unknown }
  return Array.isArray(o.environments) && Array.isArray(o.globals)
}
