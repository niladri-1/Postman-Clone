// ---------------------------------------------------------------------------
// Postmaster shared domain models (used by main + renderer + tests)
// ---------------------------------------------------------------------------

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | string // custom methods allowed

export const STANDARD_METHODS: readonly string[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]

export type BodyType = 'none' | 'json' | 'raw' | 'urlencoded' | 'form'

export interface KeyValue {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
}

export interface FormPair extends KeyValue {
  type?: 'text'
}

export type AuthType =
  | 'none'
  | 'basic'
  | 'bearer'
  | 'apiKey'
  | 'digest'
  | 'oauth2'

export interface AuthConfig {
  type: AuthType
  username?: string
  password?: string
  token?: string
  apiKeyKey?: string
  apiKeyValue?: string
  apiKeyLocation?: 'header' | 'query'
  apiKeyIn?: string // header/query param name
  oauth2?: {
    grantType: 'clientCredentials' | 'password'
    tokenUrl: string
    clientId: string
    clientSecret: string
    username?: string
    password?: string
    scope?: string
  }
}

export interface RequestSettings {
  timeoutMs: number // 0 = never
  followRedirects: boolean
  sslVerify: boolean
  sendCookies: boolean
}

export interface RequestBody {
  type: BodyType
  raw: string
  json: string
  urlencoded: FormPair[]
  form: FormPair[]
}

export const DEFAULT_BODY: RequestBody = {
  type: 'none',
  raw: '',
  json: '',
  urlencoded: [],
  form: [],
}

export const DEFAULT_SETTINGS: RequestSettings = {
  timeoutMs: 0,
  followRedirects: true,
  sslVerify: true,
  sendCookies: true,
}

export interface RequestDraft {
  method: HttpMethod
  url: string
  headers: KeyValue[]
  query: KeyValue[]
  body: RequestBody
  auth: AuthConfig
  settings: RequestSettings
  /** name shown in tab headers */
  name?: string
  /** collectionVars runtime override from scripts */
  runtimeVars?: Record<string, string>
  /** pre-request / post-response scripts (JS source; run in the main-process sandbox) */
  scripts?: { pre?: string; post?: string }
}

export const DEFAULT_REQUEST: RequestDraft = {
  method: 'GET',
  url: '',
  headers: [],
  query: [],
  body: DEFAULT_BODY,
  auth: { type: 'none' },
  settings: DEFAULT_SETTINGS,
}

// --- saved objects ---------------------------------------------------------

export type SavedRequest = RequestDraft & {
  id: string
  name: string
  description?: string
}

export interface FolderItem {
  id: string
  kind: 'folder'
  name: string
  items: CollectionItem[]
}

export interface RequestItem {
  id: string
  kind: 'request'
  name: string
  request: SavedRequest
}

export type CollectionItem = FolderItem | RequestItem

export interface Collection {
  id: string
  name: string
  items: CollectionItem[]
  description?: string
}

// --- environments ----------------------------------------------------------

export interface EnvVar {
  id: string
  key: string
  value: string
  secret: boolean
}

export interface Environment {
  id: string
  name: string
  variables: EnvVar[]
}

// --- history ---------------------------------------------------------------

export interface HistoryHttpResponse {
  status: number
  statusText: string
  headers: { key: string; value: string }[]
  bodyTruncated: boolean
  body: string | null // body if <= HISTORY_BODY_LIMIT else first bytes
  bodyEncoding: 'text' | 'base64'
  durationMs: number
  sizeBytes: number
  contentType: string
}

export interface HistoryEntry {
  id: string
  ts: number
  name: string
  method: HttpMethod
  url: string
  response?: HistoryHttpResponse
  error?: string
}

// --- settings ---------------------------------------------------------------

export interface AppSettings {
  httpVersion: 'auto' | 'HTTP/1.1' | 'HTTP/2'
  requestTimeoutMs: number
  maxResponseSizeMb: number
  sslVerify: boolean
  sslKeylog: boolean
  disableCookies: boolean
  responseFormatDetection: 'auto' | 'json'
  workingDirectory: string
  proxy: { mode: 'system' | 'none' | 'manual'; host: string; port: number; bypass: string }
  followRedirects: boolean
  theme: 'dark' | 'light'
  tabSize: number
  autosave: boolean
  /** debounced auto-save delay in ms; 0 disables auto-save (manual export only) */
  autosaveMs: number
  /** interface zoom level in percent (50–200) */
  zoom: number
  historyLimit: number
  /** font family for the app chrome */
  uiFontFamily: string
  /** base font size (px) for the app chrome */
  uiFontSize: number
  /** font family for URL bar, editors, code */
  editorFontFamily: string
  /** font size (px) for URL bar, editors, code */
  editorFontSize: number
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  httpVersion: 'auto',
  requestTimeoutMs: 0,
  maxResponseSizeMb: 50,
  sslVerify: true,
  sslKeylog: false,
  disableCookies: false,
  responseFormatDetection: 'auto',
  workingDirectory: '',
  proxy: { mode: 'system', host: '', port: 0, bypass: '' },
  followRedirects: true,
  theme: 'dark',
  tabSize: 4,
  autosave: true,
  autosaveMs: 2000,
  zoom: 100,
  historyLimit: 500,
  uiFontFamily: 'Segoe UI',
  uiFontSize: 13,
  editorFontFamily: 'Cascadia Code',
  editorFontSize: 13,
}

// --- tabs -------------------------------------------------------------------

export interface OpenTab {
  id: string
  collectionId?: string
  requestId?: string // undefined = unsaved scratch request
  folderPath?: string[] // ids for breadcrumb
  name: string
  draft: RequestDraft
  dirty: boolean
}
