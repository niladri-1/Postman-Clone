/**
 * Script IPC — runs pre-request/post-response scripts in a sandboxed VM.
 * The renderer composes the context; main applies variable writes returned by
 * the script run onto the stores sent back by the renderer.
 */
import type { IpcMain } from 'electron'
import { runScript, type ScriptRun } from '../scripts/scripts'

export interface ScriptPayload {
  script: string
  timeoutMs?: number
  context: {
    variables: { globals: Record<string, string>; environment: Record<string, string>; collection: Record<string, string> }
    request: { method: string; url: string; headers: Record<string, string>; body?: string }
    response?: {
      code: number
      status: string
      responseTime: number
      headers: { key: string; value: string }[]
      sizeBytes: number
      body: string | null
      contentType: string
    }
  }
}

export function registerScriptIpc(ipcMain: IpcMain): void {
  ipcMain.handle('script:run', (_e, payload: ScriptPayload | unknown): ScriptRun => {
    const p = validate(payload)
    if (p instanceof Error) {
      return {
        logs: [],
        tests: [],
        envSets: {},
        globalSets: {},
        collectionSets: {},
        error: p.message,
        durationMs: 0,
      }
    }
    return runScript({
      script: p.script,
      timeoutMs: p.timeoutMs,
      context: { variables: p.context.variables, request: p.context.request, response: p.context.response },
    })
  })
}

const MAX_SCRIPT_LENGTH = 262144

function validate(v: ScriptPayload | unknown): ScriptPayload | Error {
  if (typeof v !== 'object' || v === null) return new Error('payload must be an object')
  const o = v as Partial<ScriptPayload>
  if (typeof o.script !== 'string') return new Error('script required')
  if (o.script.length > MAX_SCRIPT_LENGTH) return new Error('script too large')
  if (typeof o.context !== 'object' || o.context === null) return new Error('context required')
  const c = o.context as Partial<ScriptPayload['context']>
  if (typeof c.request !== 'object' || c.request === null) return new Error('context.request required')
  if (typeof c.variables !== 'object' || c.variables === null) return new Error('context.variables required')
  if (typeof o.timeoutMs === 'number' && (o.timeoutMs < 1 || o.timeoutMs > 30000)) {
    return new Error('timeoutMs out of bounds')
  }
  return o as ScriptPayload
}
