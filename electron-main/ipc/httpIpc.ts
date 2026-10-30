/**
 * HTTP IPC: validations + invocation of the HttpService. The renderer sends a
 * compact SendPayload; the main process resolves settings precedence
 * (per-request settings override app defaults for timeout/redirects/ssl/cookies).
 */
import type { IpcMain } from 'electron'
import { HttpService, type SendOptions, type HttpResult, type HttpError } from '../http/httpService'
import type { RequestDraft } from '../../shared/models'

export interface SendPayload {
  requestId: string
  draft: RequestDraft
  scope: {
    globals?: Record<string, string>
    environment?: Record<string, string>
    runtime?: Record<string, string>
  }
  defaults: {
    timeoutMs: number
    maxResponseSizeMb: number
    sslVerify: boolean
    disableCookies: boolean
    proxy?: { mode: 'system' | 'none' | 'manual'; host: string; port: number; bypass?: string }
  }
}

export function registerHttpIpc(ipcMain: IpcMain, http: HttpService): void {
  ipcMain.handle('http:send', async (_e, payload: SendPayload | unknown): Promise<HttpResult | HttpError> => {
    const p = validatePayload(payload)
    if (p instanceof Error) {
      return { requestId: '', code: 'BAD_PAYLOAD', message: p.message, durationMs: 0 }
    }
    return new Promise<HttpResult | HttpError>((resolve) => {
      http.send(toSendOptions(p), (result) => resolve(result))
    })
  })

  ipcMain.handle('http:cancel', (_e, requestId: unknown): boolean => {
    if (typeof requestId !== 'string') return false
    return http.cancel(requestId)
  })
}

function toSendOptions(p: SendPayload): SendOptions {
  const s = p.draft.settings
  return {
    requestId: p.requestId,
    draft: p.draft,
    scope: p.scope,
    useCookies: !p.defaults.disableCookies && s.sendCookies !== false,
    maxResponseSizeMb: Math.max(1, Math.floor(p.defaults.maxResponseSizeMb)),
    // per-request explicit boolean wins over the app-wide default
    sslVerify: typeof s.sslVerify === 'boolean' ? s.sslVerify : p.defaults.sslVerify,
    timeoutMs: s.timeoutMs > 0 ? s.timeoutMs : p.defaults.timeoutMs,
    proxy: p.defaults.proxy ?? { mode: 'system', host: '', port: 0 },
  }
}

function validatePayload(v: SendPayload | undefined | unknown): SendPayload | Error {
  if (typeof v !== 'object' || v === null) return new Error('payload must be an object')
  const o = v as Partial<SendPayload>
  if (typeof o.requestId !== 'string') return new Error('requestId required')
  if (!isDraft(o.draft)) return new Error('draft required')
  if (typeof o.scope !== 'object' || o.scope === null) return new Error('scope required')
  if (typeof o.defaults !== 'object' || o.defaults === null) return new Error('defaults required')
  const d = o.defaults as Partial<SendPayload['defaults']>
  if (typeof d.timeoutMs !== 'number' || typeof d.maxResponseSizeMb !== 'number' || typeof d.sslVerify !== 'boolean') {
    return new Error('defaults invalid')
  }
  return o as SendPayload
}

function isDraft(d: RequestDraft | undefined | unknown): d is RequestDraft {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Partial<RequestDraft>
  return typeof o.method === 'string' && typeof o.url === 'string' && Array.isArray(o.headers) && Array.isArray(o.query)
}
