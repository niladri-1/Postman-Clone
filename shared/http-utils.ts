import type { AuthConfig, RequestDraft } from './models'

export interface QsPair {
  id: string
  key: string
  value: string
  description: string
  enabled: boolean
}

/**
 * Split a URL into its base part and query pairs so they can surface in the
 * Params table (mirrors the reference app's URL-to-params sync).
 */
export function splitUrl(url: string): { base: string; pairs: QsPair[] | null } {
  const qIdx = url.indexOf('?')
  if (qIdx < 0) {
    return { base: url, pairs: null }
  }
  const rawQuery = url.slice(qIdx + 1)
  return { base: url.slice(0, qIdx), pairs: parseQs(rawQuery) }
}

function parseQs(raw: string): QsPair[] {
  if (raw === '') {
    return []
  }
  const out: QsPair[] = []
  for (const piece of raw.split(/[?&]/)) {
    if (piece === '') continue
    const eq = piece.indexOf('=')
    const rawKey = eq < 0 ? piece : piece.slice(0, eq)
    const rawValue = eq < 0 ? '' : piece.slice(eq + 1)
    let key = rawKey
    let value = rawValue
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '))
    } catch {
      /* keep raw representation for malformed utf8 sequences */
    }
    out.push({ id: newUid(), key, value, description: '', enabled: true })
  }
  return out
}

function newUid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** Rebuild the URL string from a base and the enabled rows. */
export function buildUrl(base: string, rows: QsPair[] | null): string {
  if (!rows) return base
  const enabled = rows.filter((r) => r.enabled)
  if (enabled.length === 0) return base
  const qs = enabled
    .map((p) => {
      const k = encodeURIComponent(p.key)
      if (p.value === '') return k
      return k + '=' + encodeURIComponent(p.value)
    })
    .join('&')
  return base + '?' + qs
}

function basicToken(user: string, pass: string): string {
  const raw = user + ':' + pass
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(raw)
  }
  // Node/main-process fallback (Electron main has no btoa)
  const nodeBuffer = (globalThis as { Buffer?: { from(s: string): { toString(e: string): string } } }).Buffer
  if (nodeBuffer) {
    return nodeBuffer.from(raw).toString('base64')
  }
  return raw
}

/** cURL export for the Share dialog. */
export function toCurl(draft: RequestDraft): string {
  const method = draft.method || 'GET'
  const parts: string[] = ['curl']
  if (method !== 'GET') {
    parts.push('-X ' + method)
  }
  for (const h of draft.headers) {
    if (h.enabled !== false && h.key) {
      parts.push('-H "' + h.key + ': ' + escapeQuote(h.value) + '"')
    }
  }
  switch (draft.body.type) {
    case 'json':
      parts.push('-H "Content-Type: application/json"')
      parts.push('--data-raw "' + escapeQuote(draft.body.json) + '"')
      break
    case 'raw':
      parts.push('--data-raw "' + escapeQuote(draft.body.raw) + '"')
      break
    case 'urlencoded': {
      const entries = draft.body.urlencoded
        .filter((p) => p.enabled !== false)
        .map((p) => p.key + '=' + p.value)
        .join('&')
      if (entries) {
        parts.push('--data-raw "' + escapeQuote(entries) + '"')
      }
      break
    }
    case 'form':
      for (const p of draft.body.form) {
        if (p.enabled !== false && p.key) {
          parts.push('-F "' + escapeQuote(p.key) + '=' + escapeQuote(p.value) + '"')
        }
      }
      break
    default:
      break
  }
  parts.push('"' + escapeQuote(draft.url) + '"')
  return parts.join(' \\\n  ')
}

function escapeQuote(v: string): string {
  return v.replace(/"/g, '\\"')
}

/** Authorization header contribution for static schemes (basic/bearer/api-key). */
export function staticAuthHeaders(auth: AuthConfig): Record<string, string> {
  switch (auth.type) {
    case 'basic':
      return { Authorization: 'Basic ' + basicToken(auth.username ?? '', auth.password ?? '') }
    case 'bearer':
      return { Authorization: 'Bearer ' + (auth.token ?? '') }
    case 'apiKey':
      if (auth.apiKeyLocation === 'header') {
        return { [auth.apiKeyIn || 'X-Api-Key']: auth.apiKeyValue ?? '' }
      }
      return {}
    default:
      return {}
  }
}

export const basicTokenPair = basicToken
