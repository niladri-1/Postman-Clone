import type { AppSettings, Collection, EnvVar, Environment, OpenTab, RequestDraft, HistoryEntry } from '../../shared/models'

// The preload-injected surface (see electron-main/preload.ts)
export interface PostmasterBridge {
  loadStores: () => Promise<{
    collections: Collection[]
    environments: { environments: Environment[]; globals: EnvVar[] }
    history: HistoryEntry[]
    settings: AppSettings
    tabs: { tabs: OpenTab[] }
  }>
  saveStore: (name: string, data: unknown) => Promise<{ ok?: boolean; error?: string }>
  sendHttp: (payload: unknown) => Promise<
    | {
        requestId: string
        status: number
        statusText: string
        headers: { key: string; value: string }[]
        body: string | null
        bodyBytes: number
        truncated: boolean
        decoded: boolean
        durationMs: number
        timeStart: number
        contentType: string
        redirected: boolean
      }
    | {
        requestId: string
        code: string
        message: string
        durationMs: number
      }
  >
  cancelHttp: (requestId: string) => Promise<boolean>
  runScript: (payload: unknown) => Promise<{
    logs: { ts: number; level: string; message: string }[]
    tests: { name: string; passed: boolean; error?: string }[]
    envSets: Record<string, string>
    globalSets: Record<string, string>
    collectionSets: Record<string, string>
    error?: string
    durationMs: number
  }>
  appInfo: () => Promise<{ version: string; electron: string; chrome: string; node: string; platform: string }>
  importFile: () => Promise<{ path?: string; content?: string; error?: string } | null>
  exportFile: (name: string, content: string) => Promise<{ saved?: string; canceled?: boolean; error?: string }>
  listCookies: () => Promise<
    { domain: string; path: string; name: string; value: string; expires: number | null; secure: boolean; httpOnly: boolean }[]
  >
  clearCookies: (domain?: string) => Promise<boolean>
  openExternal: (url: string) => Promise<boolean>
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  /** set window zoom, percent 50–200 */
  setZoom: (percent: number) => Promise<number | null>
}

declare global {
  interface Window {
    postmaster?: PostmasterBridge
  }
}

/** The bridge or null when the UI runs in a plain browser without Electron. */
export const pm: PostmasterBridge | null = typeof window !== 'undefined' ? (window.postmaster ?? null) : null

/** Basic-auth header helper safe in the renderer. */
export function b64(v: string): string {
  return window.btoa(v)
}

/** Draft formatting helper used by several components. */
export function draftName(d: RequestDraft): string {
  if (d.name) return d.name
  try {
    const u = new URL(d.url)
    return u.hostname || 'Untitled'
  } catch {
    return d.url.startsWith('http') ? 'Untitled' : 'Untitled'
  }
}
