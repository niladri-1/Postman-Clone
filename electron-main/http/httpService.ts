/**
 * Request execution service. Runs HTTP(S) requests on Electron's `net` module
 * (Chromium network service) inside the main process:
 *   - redirects (follow/error), gzip/br handled by the network service
 *   - bounded response buffering (app settings maxResponseSizeMb)
 *   - cancellation + timeout (socket destroy)
 *   - per-request cookies on/off via a dedicated session partition
 *   - TLS verify toggle via setCertificateVerifyProc (explicit user choice)
 *   - secrets are never logged
 */
import { app, net, Session, session } from 'electron'
import zlib from 'node:zlib'
import { genId } from '../../shared/ids'
import type {
  AuthConfig,
  KeyValue,
  RequestDraft,
  RequestSettings,
} from '../../shared/models'
import { staticAuthHeaders } from '../../shared/http-utils'
import { resolveDraft, type VarScope } from '../../shared/variables'

export interface SendOptions {
  requestId: string
  draft: RequestDraft
  scope: VarScope
  useCookies: boolean
  maxResponseSizeMb: number
  sslVerify: boolean
  timeoutMs: number // combined effective timeout, 0 = never
  proxy: { mode: 'system' | 'none' | 'manual'; host: string; port: number; bypass?: string }
}

export interface HttpResult {
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

export interface HttpError {
  requestId: string
  code: string
  message: string
  durationMs: number
}

const STATUS_PHRASES: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted',
  203: 'Non-Authoritative Information', 204: 'No Content', 205: 'Reset Content',
  206: 'Partial Content', 300: 'Multiple Choices', 301: 'Moved Permanently',
  302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect',
  308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized',
  402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout',
  409: 'Conflict', 410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed',
  413: 'Payload Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable', 417: 'Expectation Failed', 418: "I'm a teapot",
  422: 'Unprocessable Entity', 426: 'Upgrade Required', 429: 'Too Many Requests',
  431: 'Request Header Fields Too Large', 500: 'Internal Server Error',
  501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable',
  504: 'Gateway Timeout', 505: 'HTTP Version Not Supported',
}

const COOKIE_PARTITION = 'postmaster-cookie-store'

function getSessionFor(useCookies: boolean): Session {
  if (useCookies) {
    const ses = session.fromPartition(COOKIE_PARTITION, { cache: true })
    return ses
  }
  // fresh, in-memory, no shared jar: use a unique partition per request so nothing persists
  return session.fromPartition(`no-cookie-${genId()}`, { cache: true })
}

type Inflight = () => void

export class HttpService {
  private inflight = new Map<string, Inflight>()

  send(opts: SendOptions, onDone: (r: HttpResult | HttpError) => void): void {
    const started = performance.now()
    const cancelWith = (cancel: () => void) => this.inflight.set(opts.requestId, cancel)
    const finish = (r: HttpResult | HttpError) => {
      this.inflight.delete(opts.requestId)
      onDone(r)
    }

    let draft: RequestDraft
    try {
      draft = resolveDraft(opts.draft, opts.scope)
    } catch {
      finish({ requestId: opts.requestId, code: 'INJECT', message: 'Variable resolution failed', durationMs: 0 })
      return
    }

    if (!/^https?:\/\//i.test(draft.url.trim())) {
      finish({
        requestId: opts.requestId,
        code: 'BAD_URL',
        message: 'Provide a valid http(s) URL (missing scheme)',
        durationMs: sinceStarted(started),
      })
      return
    }

    // URL: apply URI/query params (postman-style: URL bar includes query already)
    let url: URL
    try {
      url = new URL(draft.url.trim())
    } catch {
      finish({
        requestId: opts.requestId,
        code: 'BAD_URL',
        message: 'Could not parse URL',
        durationMs: sinceStarted(started),
      })
      return
    }
    // apply query params and query-based API keys BEFORE creating the request
    for (const q of draft.query) {
      if (q.enabled === false) continue
      if (!q.key) continue
      url.searchParams.append(q.key, q.value)
    }
    if (draft.auth.type === 'apiKey' && draft.auth.apiKeyLocation === 'query' && draft.auth.apiKeyIn) {
      url.searchParams.set(draft.auth.apiKeyIn, draft.auth.apiKeyValue ?? '')
    }

    const ses = getSessionFor(opts.useCookies)
    if (opts.proxy.mode === 'manual') {
      const rules = `${opts.proxy.host.startsWith('http') ? opts.proxy.host : `http://${opts.proxy.host}`}:${opts.proxy.port}`
      ses.setProxy({ proxyRules: rules, proxyBypassRules: opts.proxy.bypass ?? '' }).catch(() => {})
    } else if (opts.proxy.mode === 'none') {
      ses.setProxy({ mode: 'direct' }).catch(() => {})
    }

    // NOTE: TLS bypass is a global explicit option; safe default is verify.
    configureCertVerification(opts.sslVerify)

    const request = net.request({
      method: draft.method,
      url: url.toString(),
      session: ses,
      redirect: draft.settings.followRedirects ? 'follow' : 'error',
      useSessionCookies: opts.useCookies,
    })

    // headers
    const headers: Record<string, string> = {}
    for (const h of draft.headers) {
      if (!h.enabled || !h.key) continue
      // multiple same-key headers are joined; a safer multi-map would be per-occurrence
      headers[h.key] = h.value
    }
    // auth header contributions
    const auth: Record<string, string> = staticAuthHeaders(draft.auth)
    for (const [k, v] of Object.entries(auth)) headers[k] = v
    // body
    const bodyPayload = composeBody(draft)
    if (bodyPayload) {
      for (const [k, v] of Object.entries(bodyPayload.headers)) headers[k] = v
    }
    // default UA (no fingerprint of Postman)
    if (headers['User-Agent'] === undefined) headers['User-Agent'] = `Postmaster/${app.getVersion()}`
    if (headers['Cache-Control'] === undefined) headers['Cache-Control'] = 'no-cache'

    for (const [k, v] of Object.entries(headers)) {
      try {
        request.setHeader(k, v)
      } catch {
        /* invalid header names are rejected by Chromium; keep silent */
      }
    }

    const maxBytes = Math.max(0, Math.floor(opts.maxResponseSizeMb)) * 1024 * 1024
    let chunks: Buffer[] = []
    let received = 0
    let truncated = false
    let contentType = ''
    let redirected = false

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const effectiveTimeout = opts.timeoutMs > 0 ? opts.timeoutMs : 0
    if (effectiveTimeout > 0) {
      timeoutHandle = setTimeout(() => {
        try {
          request.abort()
        } catch {
          /* noop */
        }
      }, effectiveTimeout)
      if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref()
    }

    const doRequest = (body: Buffer | null) => {
      let settled = false
      const complete = (result: HttpResult | HttpError) => {
        if (settled) return
        settled = true
        if (timeoutHandle) clearTimeout(timeoutHandle)
        finish(result)
      }
      cancelWith(() => {
        try {
          request.abort()
        } catch {
          /* noop */
        }
      })
      request.on('response', (response) => {
        const status = response.statusCode
        const statusText = STATUS_PHRASES[status] ?? ''
        contentType = headerValue(response.headers, 'content-type')
        if (response.headers.location !== undefined) redirected = true
        const outHeaders: { key: string; value: string }[] = []
        for (const [key, values] of Object.entries(response.headers)) {
          const vv = Array.isArray(values) ? values : [values]
          for (const v of vv) {
            if (typeof v === 'string') outHeaders.push({ key, value: v })
          }
        }
        response.on('data', (chunk: Buffer) => {
          if (received + chunk.length > maxBytes && maxBytes > 0) {
            const space = Math.max(0, maxBytes - received)
            if (space > 0) chunks.push(chunk.subarray(0, space))
            received += space
            truncated = true
            try {
              request.abort()
            } catch {
              /* noop */
            }
          } else {
            chunks.push(chunk)
            received += chunk.length
          }
        })
        response.on('end', () => {
          const raw = Buffer.concat(chunks)
          const encodeHeader = headerValue(response.headers, 'content-encoding')
          let decoded = false
          let bufferOut: Buffer<ArrayBufferLike> = raw
          if (raw.length > 0 && encodeHeader.length > 0 && DECODE_RE.test(encodeHeader)) {
            try {
              const out = decompress(raw, encodeHeader)
              if (out !== raw) {
                bufferOut = out
                decoded = true
              }
            } catch {
              /* leave raw body if decompression fails */
            }
          }
          const isText = isTextual(contentType)
          const finalBody = !isText ? null : bufferOut.toString('utf8')
          complete({
            requestId: opts.requestId,
            status,
            statusText,
            headers: outHeaders,
            body: finalBody,
            bodyBytes: received,
            truncated,
            decoded,
            durationMs: sinceStarted(started),
            timeStart: Math.round(started),
            contentType,
            redirected,
          })
        })
        response.on('error', (err: Error) => complete(errToError(opts.requestId, err, sinceStarted(started))))
      })
      request.on('error', (err: Error) => complete(errToError(opts.requestId, err, sinceStarted(started))))
      request.end(body ?? undefined)
    }

    if (bodyPayload) {
      doRequest(bodyPayload.buffer)
    } else {
      doRequest(null)
    }
  }

  cancel(requestId: string): boolean {
    const entry = this.inflight.get(requestId)
    if (!entry) return false
    entry()
    this.inflight.delete(requestId)
    return true
  }

  isRunning(requestId: string): boolean {
    return this.inflight.has(requestId)
  }

  dispose(): void {
    this.inflight.clear()
  }
}

const BINARY_RE = /(octet-stream|image\/|audio\/|video\/|application\/zip|application\/pdf|font\/)/i
const DECODE_RE = /(gzip|br|deflate)/i

function decompress(buf: Buffer, enc: string): Buffer {
  if (enc.includes('gzip') && (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b)) return buf
  if (enc.includes('gzip')) return zlib.gunzipSync(buf)
  if (enc.includes('br') && buf.length > 3) return zlib.brotliDecompressSync(buf)
  if (enc.includes('deflate')) {
    try {
      return zlib.inflateSync(buf)
    } catch {
      return zlib.inflateRawSync(buf)
    }
  }
  return buf
}

function isTextual(ct: string): boolean {
  if (!ct) return true // per RFC, heuristics
  if (BINARY_RE.test(ct)) return false
  if (/json|text|xml|javascript|csv|html/i.test(ct)) return true
  return false
}

function headerValue(headers: Record<string, string | string[]>, key: string): string {
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      const arr = Array.isArray(v) ? v : [v]
      return arr[0] ?? ''
    }
  }
  return ''
}

function sinceStarted(started: number): number {
  return Math.round(performance.now() - started)
}

function errToError(requestId: string, err: Error, durationMs: number): HttpError {
  return {
    requestId,
    code: errFromCode(err),
    message: sanitize(err.message),
    durationMs,
  }
}

function errFromCode(err: Error): string {
  if (/timed out|timeout/i.test(err.message)) return 'TIMEOUT'
  if ((err as NodeJS.ErrnoException).code === 'ERR_NAME_NOT_RESOLVED') return 'DNS'
  if (/(connect ECONNREFUSED|connection refused)/i.test(String(err))) return 'REFUSED'
  return 'NETWORK'
}

function sanitize(message: string): string {
  // defensive scrub in case libraries echo header values (no tokens leak)
  let s = message
  s = s.replace(/Bearer [A-Za-z0-9._~+/=-]+/gi, 'Bearer ●●●●●●')
  s = s.replace(/([?&])?(access_token|api_?key|token|secret)=[^&\s]*/gi, '$1$2=●●●●●●')
  return s
}

interface ComposedBody {
  buffer: Buffer
  headers: Record<string, string>
}

function composeBody(draft: RequestDraft): ComposedBody | null {
  switch (draft.body.type) {
    case 'json':
      return { buffer: Buffer.from(draft.body.json, 'utf8'), headers: { 'Content-Type': 'application/json' } }
    case 'raw':
      return { buffer: Buffer.from(draft.body.raw, 'utf8'), headers: {} }
    case 'urlencoded': {
      const usp = new URLSearchParams()
      for (const p of draft.body.urlencoded) {
        if (!p.enabled) continue
        usp.append(p.key, p.value)
      }
      const s = usp.toString()
      if (!s) return null
      return { buffer: Buffer.from(s, 'utf8'), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    }
    case 'form': {
      const boundary = `----PostmasterBoundary${genId().replace(/-/g, '')}`
      const parts: Buffer[] = []
      for (const p of draft.body.form) {
        if (!p.enabled || !p.key) continue
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.key}"\r\n\r\n`, 'utf8'))
        parts.push(Buffer.from(p.value, 'utf8'))
        parts.push(Buffer.from('\r\n', 'utf8'))
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
      return {
        buffer: Buffer.concat(parts),
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      }
    }
    default:
      return null
  }
}

function configureCertVerification(verify: boolean): void {
  const ses = session.fromPartition(COOKIE_PARTITION)
  configureSessionCerts(ses, verify)
  // also the default session (renderer webs)
  configureSessionCerts(session.defaultSession, verify)
}

function configureSessionCerts(ses: Session, verify: boolean): void {
  if (!verify) {
    // explicit user opt-out — never the default. callback(0) accepts the
    // certificate even when Chromium's default verification would reject it.
    ses.setCertificateVerifyProc((_req, callback) => {
      callback(0)
    })
  } else {
    ses.setCertificateVerifyProc(null)
  }
}

export type { RequestSettings, AuthConfig, KeyValue }
