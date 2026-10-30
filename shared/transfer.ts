/**
 * Import: Postman Collection v2.x JSON, OpenAPI 3.x JSON, Postman Environment v2.x.
 * Export: Postmaster side, Postman-compatible collection and environment formats.
 */

import type { Collection, CollectionItem, Environment, KeyValue, RequestBody, RequestDraft, RequestItem, FolderItem } from './models'
import { DEFAULT_BODY, DEFAULT_REQUEST } from './models'
import { genId } from './ids'

// ---- Postman collection v2.1 types (subset we support) ----------------------

interface PostmanKV {
  key: string
  value?: string
  description?: string
  disabled?: boolean
  type?: string
  src?: unknown
}
interface PostmanRequest {
  method?: string
  url?: string | { raw?: string; query?: PostmanKV[]; host?: string[]; path?: string[] }
  header?: PostmanKV[]
  body?: { mode?: string; raw?: string; urlencoded?: PostmanKV[]; formdata?: PostmanKV[]; options?: { raw?: { language?: string } } }
  auth?: { type?: string; basic?: PostmanKV[]; bearer?: { token?: string }[]; apikey?: PostmanKV[] }
  description?: string
}
interface PostmanCollectionItem {
  name?: string
  request?: PostmanRequest
  item?: PostmanCollectionItem[]
  response?: unknown[]
}
interface PostmanCollection {
  info?: { name?: string; description?: string; schema?: string; _postman_id?: string }
  item?: PostmanCollectionItem[]
  variable?: PostmanKV[]
}

const notEmpty = (s?: string) => typeof s === 'string' && s.length > 0

function kvList(list: unknown, defaults: { enabled: boolean; idPrefix: string }): KeyValue[] {
  if (!Array.isArray(list)) return []
  return list.map((raw) => {
    const kv = raw as PostmanKV
    return {
      id: genId(),
      key: kv.key ?? '',
      value: kv.value ?? '',
      description: kv.description ?? '',
      enabled: kv.disabled === true ? false : defaults.enabled,
    }
  })
}

function mapBody(req: PostmanRequest): RequestBody {
  const body = req.body
  if (!body?.mode) return { ...DEFAULT_BODY }
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language
      if (lang === 'json') {
        return { type: 'json', raw: '', json: body.raw ?? '', urlencoded: [], form: [] }
      }
      return { type: 'raw', raw: body.raw ?? '', json: '', urlencoded: [], form: [] }
    }
    case 'urlencoded':
      return { type: 'urlencoded', raw: '', json: '', urlencoded: kvList(body.urlencoded, { enabled: true, idPrefix: 'b' }), form: [] }
    case 'formdata':
      return { type: 'form', raw: '', json: '', urlencoded: [], form: kvList(body.formdata, { enabled: true, idPrefix: 'f' }) }
    default:
      return { ...DEFAULT_BODY }
  }
}

function mapAuth(auth: PostmanRequest['auth']): RequestDraft['auth'] {
  if (!auth || notEmpty(auth.type) === false) return { type: 'none' }
  switch (auth.type) {
    case 'basic': {
      const fields = auth.basic ?? []
      const get = (k: string) => fields.find((f) => f.key === k)?.value ?? ''
      return { type: 'basic', username: get('username'), password: get('password') }
    }
    case 'bearer': {
      const fields = auth.bearer ?? []
      return { type: 'bearer', token: fields[0]?.token ?? '' }
    }
    case 'apikey': {
      const fields = auth.apikey ?? []
      const get = (k: string) => fields.find((f) => f.key === k)?.value ?? ''
      const location = get('in') === 'query' ? 'query' : 'header'
      return {
        type: 'apiKey',
        apiKeyKey: get('key'),
        apiKeyValue: get('value'),
        apiKeyLocation: location,
        apiKeyIn: get('key'),
      }
    }
    case 'oauth2':
      return { type: 'oauth2' }
    case 'digest':
      return { type: 'digest' }
    default:
      return { type: 'none' }
  }
}

function mapUrlField(url: PostmanRequest['url']): string {
  if (typeof url === 'string') return url
  if (url && typeof url === 'object' && typeof url.raw === 'string') return url.raw
  if (url && typeof url === 'object') {
    const host = (url.host ?? []).join('.')
    const path = (url.path ?? []).join('/')
    return host ? `https://${host}${path ? '/' + path : ''}` : ''
  }
  return ''
}

function mapPostmanRequest(p: PostmanRequest, name: string): RequestItem {
  const draft: RequestDraft = {
    ...DEFAULT_REQUEST,
    method: (p.method ?? 'GET').toUpperCase(),
    url: mapUrlField(p.url),
    headers: kvList(p.header, { enabled: true, idPrefix: 'h' }),
    query: extractQueryFromUrl(mapUrlField(p.url)),
    body: mapBody(p),
    auth: mapAuth(p.auth),
  }
  return {
    id: genId(),
    kind: 'request',
    name,
    request: { ...draft, id: genId(), name, description: typeof p.description === 'string' ? p.description : undefined },
  }
}

/** Derive enabled query rows from the raw url (key=value pairs after ?) with a case for each. */
function extractQueryFromUrl(rawUrl: string): KeyValue[] {
  const qIdx = rawUrl.indexOf('?')
  if (qIdx < 0) return []
  const qs = rawUrl.slice(qIdx + 1)
  return qs.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    const k = eq < 0 ? pair : pair.slice(0, eq)
    const v = eq < 0 ? '' : pair.slice(eq + 1)
    let dk = k
    let dv = v
    try {
      dk = decodeURIComponent(k)
      dv = decodeURIComponent(v)
    } catch {
      /* retain raw on bad utf8 */
    }
    return { id: genId(), key: dk, value: dv, description: '', enabled: true }
  })
}

function mapItems(items: PostmanCollectionItem[], parentName: string): CollectionItem[] {
  const out: CollectionItem[] = []
  for (const it of items) {
    if (it.request) {
      out.push(mapPostmanRequest(it.request, it.name ?? 'Untitled Request'))
    } else if (it.item) {
      const folder: FolderItem = {
        id: genId(),
        kind: 'folder',
        name: it.name ?? (parentName ? parentName + ' folder' : 'Folder'),
        items: mapItems(it.item, it.name ?? ''),
      }
      out.push(folder)
    }
  }
  return out
}

/** Parse a Postman v2.x collection JSON string into a Postmaster Collection. */
export function importPostmanCollection(json: string): Collection {
  const data = JSON.parse(json) as PostmanCollection
  if (!data?.info || !Array.isArray(data.item)) {
    throw new Error('Not a valid Postman Collection (v2.x) file')
  }
  return {
    id: genId(),
    name: data.info.name ?? 'Imported Collection',
    description: typeof data.info.description === 'string' ? data.info.description : undefined,
    items: mapItems(data.item, data.info.name ?? ''),
  }
}

// ---- OpenAPI 3 --------------------------------------------------------------

interface OApiOperation {
  summary?: string
  operationId?: string
  parameters?: {
    name?: string
    in?: string
    required?: boolean
    example?: unknown
    schema?: { default?: unknown }
  }[]
  requestBody?: {
    content?: Record<string, { example?: unknown }>
  } | null
  servers?: { url?: string }[]
}
interface OApiPath {
  summary?: string
  get?: OApiOperation
  post?: OApiOperation
  put?: OApiOperation
  patch?: OApiOperation
  delete?: OApiOperation
  head?: OApiOperation
  options?: OApiOperation
}
interface OApiSpec {
  info?: { title?: string; version?: string; description?: string }
  servers?: { url?: string }[]
  paths?: Record<string, OApiPath>
}

const METHODS_OAPI = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

function pathToTemplate(path: string): string {
  return path.replace(/\{([^}]+)\}/g, '{{$1}}')
}

export function importOpenApi(json: string): Collection {
  const spec = JSON.parse(json) as OApiSpec
  if (!spec?.paths) throw new Error('Not a valid OpenAPI 3 specification (missing paths)')
  const name = spec.info?.title ?? 'Imported API'
  const groups = new Map<string, FolderItem>()
  for (const [path, pathObj] of Object.entries(spec.paths)) {
    for (const m of METHODS_OAPI) {
      const op = pathObj[m]
      if (!op) continue
      const method = m.toUpperCase()
      const serverUrl = op.servers?.[0]?.url ?? spec.servers?.[0]?.url ?? ''
      const url = serverUrl.replace(/\/$/, '') + pathToTemplate(path)
      const query: KeyValue[] = kvList(
        (op.parameters ?? []).filter((p) => p.in === 'query').map((p) => ({
          key: p.name ?? '',
          value: stringy(p.example ?? p.schema?.default ?? ''),
        })),
        { enabled: true, idPrefix: 'q' },
      )
      const headers: KeyValue[] = kvList(
        (op.parameters ?? []).filter((p) => p.in === 'header').map((p) => ({
          key: p.name ?? '',
          value: stringy(p.example ?? p.schema?.default ?? ''),
        })),
        { enabled: true, idPrefix: 'h' },
      )
      const summary = op.summary ?? op.operationId ?? `${method} ${path}`
      const tagGroup = (g: string) => {
        let folder = groups.get(g)
        if (!folder) {
          folder = { id: genId(), kind: 'folder', name: g, items: [] }
          groups.set(g, folder)
        }
        return folder
      }
      // OpenAPI tags are outside our extracted schema; group by top path segment
      const g = deriveGroup(path, name)
      const draft: RequestDraft = {
        ...DEFAULT_REQUEST,
        method,
        url,
        headers,
        query,
        body: bodyFromOpenApi(op),
      }
      const item: RequestItem = {
        id: genId(),
        kind: 'request',
        name: summary,
        request: { ...draft, id: genId(), name: summary, description: op.summary },
      }
      tagGroup(g).items.push(item)
    }
  }
  return { id: genId(), name, items: [...groups.values()] }
}

function bodyFromOpenApi(op: OApiOperation): RequestBody {
  const content = op.requestBody?.content
  if (!content) return { ...DEFAULT_BODY }
  for (const ct of Object.keys(content)) {
    if (ct.includes('json')) {
      const ex = content[ct]?.example
      const raw = ex === undefined ? '' : safeStringify(ex)
      return { type: 'json', raw: '', json: raw, urlencoded: [], form: [] }
    }
    if (ct.includes('x-www-form-urlencoded')) {
      return { type: 'urlencoded', raw: '', json: '', urlencoded: [], form: [] }
    }
    if (ct.includes('multipart')) {
      return { type: 'form', raw: '', json: '', urlencoded: [], form: [] }
    }
  }
  return { ...DEFAULT_BODY }
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return ''
  }
}

function stringy(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return safeStringify(v)
}

function deriveGroup(path: string, fallback: string): string {
  const seg = path.split('/').filter(Boolean)[0]
  return seg ? '/' + seg : fallback
}

// ---- Postman collection export --------------------------------------------

export function exportPostmanCollection(col: Collection): string {
  const postman = {
    info: {
      name: col.name,
      description: col.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      _postman_id: col.id,
    },
    item: col.items.map(exportItem),
  }
  return JSON.stringify(postman, null, 2)
}

function exportItem(item: CollectionItem): unknown {
  if (item.kind === 'folder') {
    return { name: item.name, item: item.items.map(exportItem) }
  }
  const r = item.request
  let body: Record<string, unknown> | undefined
  switch (r.body.type) {
    case 'json':
      body = { mode: 'raw', raw: r.body.json, options: { raw: { language: 'json' } } }
      break
    case 'raw':
      body = { mode: 'raw', raw: r.body.raw, options: { raw: { language: 'text' } } }
      break
    case 'urlencoded':
      body = { mode: 'urlencoded', urlencoded: r.body.urlencoded.map((p) => ({ key: p.key, value: p.value })) }
      break
    case 'form':
      body = { mode: 'formdata', formdata: r.body.form.map((p) => ({ key: p.key, value: p.value, type: 'text' })) }
      break
    default:
      body = undefined
  }
  return {
    name: item.name,
    request: {
      method: r.method,
      url: r.url,
      header: r.headers.map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
      body,
    } as unknown as PostmanRequest,
  }
}

// ---- Postmaster side export (one file, full fidelity) ----------------------

export function exportPostmasterJson(col: Collection): string {
  return JSON.stringify({ postmaster: 'postmaster.side/collection/v1', collection: col }, null, 2)
}

// ---- Environment v2 ---------------------------------------------------------

interface PostmanEnv {
  name?: string
  values?: { key: string; value?: string; enabled?: boolean; secret?: boolean }[]
}

export function importEnvironment(json: string): Environment {
  const data = JSON.parse(json) as PostmanEnv
  if (!data || !Array.isArray(data.values)) throw new Error('Not a valid Postman Environment (v2) file')
  return {
    id: genId(),
    name: data.name ?? 'Imported Environment',
    variables: data.values.map((v) => ({
      id: genId(),
      key: v.key ?? '',
      value: v.value ?? '',
      secret: v.secret === true,
    })),
  }
}

export function exportEnvironment(env: Environment): string {
  return JSON.stringify(
    { name: env.name, values: env.variables.map((v) => ({ key: v.key, value: v.value, enabled: true, secret: v.secret })) },
    null,
    2,
  )
}
