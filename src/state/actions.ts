/**
 * Renderer state mutations + orchestration (HTTP send flow, script runs,
 * persistence). Components never touch the bridge directly — they call
 * `actions.*`, which updates the external store and schedules saves.
 */
import { Store } from './store'
import type {
  AppSettings,
  Collection,
  CollectionItem,
  EnvVar,
  Environment,
  HistoryEntry,
  OpenTab,
  RequestDraft,
  SavedRequest,
} from '../../shared/models'
import { DEFAULT_APP_SETTINGS, DEFAULT_REQUEST } from '../../shared/models'
import { pm, type PostmasterBridge } from '../api/bridge'
import { varsToScope, type VarScope } from '../../shared/variables'

// --- types -----------------------------------------------------------------

export interface ResponseState {
  requestId: string
  /** transport-level failure: no HTTP status exists (DNS/refused/timeout/...) */
  failError?: string
  errorCode?: string
  /** present only when the transport delivered a response */
  status?: number
  statusText?: string
  headers: { key: string; value: string }[]
  body: string | null
  bodyBytes: number
  truncated: boolean
  durationMs: number
  contentType: string
  sentAt: number
}

export interface ScriptLogEntry {
  ts: number
  level: string
  message: string
}

export interface TestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

export type ModalName =
  | 'settings'
  | 'cookies'
  | 'import'
  | 'share'
  | 'shortcuts'
  | 'saveRequest'
  | 'newCollection'
  | 'newEnv'

export interface AppStoreState {
  ready: boolean
  collections: Collection[]
  environments: Environment[]
  globals: EnvVar[]
  activeEnvId: string | null
  settings: AppSettings
  tabs: OpenTab[]
  activeTabId: string | null
  history: HistoryEntry[]
  responses: Record<string, ResponseState>
  /** tabId -> requestId of the in-flight request */
  pending: Record<string, string>
  sidebarWidth: number
  panel: 'collections' | 'environments' | 'history' | 'cookies'
  consoleOpen: boolean
  scriptLogs: Record<string, ScriptLogEntry[]>
  testResults: Record<string, TestResult[]>
  modals: Partial<Record<ModalName, boolean>>
  toasts: ToastItem[]
}

/** Bag persisted under the 'tabs' store: tabs + which env was active. */
interface TabsBag {
  tabs: OpenTab[]
  activeEnvId?: string | null
}

let toastSeq = 1
let lastSidebarWidth = 250

export const appStore = new Store<AppStoreState>({
  ready: false,
  collections: [],
  environments: [],
  globals: [],
  activeEnvId: null,
  settings: { ...DEFAULT_APP_SETTINGS },
  tabs: [],
  activeTabId: null,
  history: [],
  responses: {},
  pending: {},
  sidebarWidth: 250,
  panel: 'collections',
  scriptLogs: {},
  testResults: {},
  modals: {},
  toasts: [],
  consoleOpen: false,
})

// --- persistence (debounced by scheduleSave) --------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSave(): void {
  if (!pm) return
  const { autosave, autosaveMs } = appStore.get().settings
  if (!autosave) return // manual mode: keep writes out of the editor loop
  if (saveTimer) clearTimeout(saveTimer)
  const delay = Math.min(600_000, Math.max(500, autosaveMs || 2_000))
  saveTimer = setTimeout(() => actions.saveAll(), delay)
}

// --- load -------------------------------------------------------------------

const BODY_TYPES: RequestDraft['body']['type'][] = ['none', 'json', 'raw', 'urlencoded', 'form']

/** Rows persisted by older/hostile files: keep only well-formed key/value rows. */
function sanitizeRows(raw: unknown): { id: string; key: string; value: string; description: string; enabled: boolean }[] {
  if (!Array.isArray(raw)) return []
  const out: { id: string; key: string; value: string; description: string; enabled: boolean }[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const o = x as Record<string, unknown>
    out.push({
      id: typeof o.id === 'string' ? o.id : 'row-' + Math.random().toString(36).slice(2, 10),
      key: typeof o.key === 'string' ? o.key : '',
      value: typeof o.value === 'string' ? o.value : '',
      description: typeof o.description === 'string' ? o.description : '',
      enabled: o.enabled !== false,
    })
  }
  return out
}

/** Body block: wrong types fall back to defaults per-field, never crash the editor. */
function sanitizeBody(raw: unknown): RequestDraft['body'] {
  const def = DEFAULT_REQUEST.body
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def
  const o = raw as Record<string, unknown>
  const type = BODY_TYPES.includes(o.type as RequestDraft['body']['type'])
    ? (o.type as RequestDraft['body']['type'])
    : def.type
  return {
    type,
    json: typeof o.json === 'string' ? o.json : def.json,
    raw: typeof o.raw === 'string' ? o.raw : def.raw,
    urlencoded: sanitizeRows(o.urlencoded),
    form: sanitizeRows(o.form),
  }
}

/** Re-inflate a persisted draft, filling any missing fields from defaults. */
function normalizeDraft(raw: Partial<RequestDraft> | undefined): RequestDraft | null {
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') return null
  const base = raw as RequestDraft
  return {
    ...DEFAULT_REQUEST,
    ...base,
    url: base.url,
    method: typeof base.method === 'string' ? base.method : DEFAULT_REQUEST.method,
    name: typeof base.name === 'string' ? base.name : undefined,
    headers: sanitizeRows(base.headers),
    query: sanitizeRows(base.query),
    body: sanitizeBody(base.body),
    auth: base.auth && typeof base.auth === 'object' ? (base.auth as RequestDraft['auth']) : { type: 'none' },
    settings: base.settings && typeof base.settings === 'object' ? { ...DEFAULT_REQUEST.settings, ...base.settings } : DEFAULT_REQUEST.settings,
    runtimeVars: base.runtimeVars && typeof base.runtimeVars === 'object' ? base.runtimeVars : undefined,
    scripts: base.scripts && typeof base.scripts === 'object' ? base.scripts : undefined,
  }
}

/** Collections arrive unvalidated from disk — keep only well-formed tree nodes. */
function normalizeItems(raw: unknown, depth = 0): CollectionItem[] {
  if (!Array.isArray(raw) || depth > 60) return []
  const out: CollectionItem[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const n = it as Record<string, unknown>
    if (typeof n.id !== 'string') continue
    if (n.kind === 'folder') {
      out.push({ id: n.id, kind: 'folder', name: typeof n.name === 'string' ? n.name : 'Folder', items: normalizeItems(n.items, depth + 1) })
      continue
    }
    const draft = normalizeDraft(n.request as Partial<RequestDraft>)
    if (draft) {
      const name = typeof n.name === 'string' ? n.name : 'Request'
      const saved: SavedRequest = { ...draft, id: n.id, name }
      out.push({ id: n.id, kind: 'request', name, request: saved })
    }
  }
  return out
}

function normalizeCollections(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) return []
  const out: Collection[] = []
  for (const c of raw) {
    if (!c || typeof c !== 'object' || typeof (c as Record<string, unknown>).id !== 'string') continue
    const o = c as Record<string, unknown>
    out.push({
      id: o.id as string,
      name: typeof o.name === 'string' ? o.name : 'Collection',
      items: normalizeItems(o.items),
    })
  }
  return out
}

function sanitizeVars(raw: unknown): EnvVar[] {
  if (!Array.isArray(raw)) return []
  const out: EnvVar[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key : ''
    if (!key) continue
    out.push({
      id: typeof o.id === 'string' ? o.id : 'v-' + Math.random().toString(36).slice(2, 10),
      key,
      value: typeof o.value === 'string' ? o.value : '',
      secret: o.secret === true,
    })
  }
  return out
}

function normalizeEnvironments(raw: unknown): Environment[] {
  if (!Array.isArray(raw)) return []
  const out: Environment[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof (e as Record<string, unknown>).id !== 'string') continue
    const o = e as Record<string, unknown>
    out.push({ id: o.id as string, name: typeof o.name === 'string' ? o.name : 'Environment', variables: sanitizeVars(o.variables) })
  }
  return out
}

function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryEntry[] = []
  for (const h of raw) {
    if (!h || typeof h !== 'object' || typeof (h as Record<string, unknown>).id !== 'string') continue
    const o = h as Record<string, unknown>
    const entry: HistoryEntry = {
      id: o.id as string,
      ts: typeof o.ts === 'number' && isFinite(o.ts) ? o.ts : Date.now(),
      name: typeof o.name === 'string' ? o.name : 'Request',
      method: (typeof o.method === 'string' ? o.method : 'GET') as HistoryEntry['method'],
      url: typeof o.url === 'string' ? o.url : '',
    }
    if (o.error && typeof o.error === 'string') entry.error = o.error
    if (o.response && typeof o.response === 'object') entry.response = o.response as HistoryEntry['response']
    out.push(entry)
  }
  return out
}

function toLoadedState(all: Awaited<ReturnType<PostmasterBridge['loadStores']>>): Partial<AppStoreState> {
  const envs = normalizeEnvironments((all.environments as { environments?: unknown })?.environments)
  const envIds = new Set(envs.map((e) => e.id))
  const bag: TabsBag = Array.isArray(all.tabs) ? (all.tabs as unknown as TabsBag) : ((all.tabs ?? {}) as TabsBag)
  const tabs: OpenTab[] = []
  for (const t of (bag.tabs ?? []) as Partial<OpenTab>[]) {
    if (!t || typeof t !== 'object') continue
    const draft = normalizeDraft(t?.draft as Partial<RequestDraft>)
    if (typeof t.id === 'string' && draft) tabs.push({ ...t, id: t.id, draft } as OpenTab)
  }
  const activeEnvId =
    typeof bag.activeEnvId === 'string' && envIds.has(bag.activeEnvId) ? bag.activeEnvId : null
  return {
    ready: true,
    collections: normalizeCollections(all.collections),
    environments: envs,
    globals: sanitizeVars((all.environments as { globals?: unknown })?.globals),
    activeEnvId,
    settings: { ...DEFAULT_APP_SETTINGS, ...(all.settings ?? {}) },
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    history: normalizeHistory(all.history),
  }
}

// --- actions ----------------------------------------------------------------

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

// --- collection tree helpers (rename/duplicate/move) -------------------------

/** Remove a node (and its subtree) from the tree. */
function removeItem(items: CollectionItem[], id: string): CollectionItem[] {
  return items
    .filter((it) => it.id !== id)
    .map((it) => (it.kind === 'folder' ? { ...it, items: removeItem(it.items, id) } : it))
}

/** Replace a single request item via a mapping function (keeps its position). */
function updateRequestIn(
  items: CollectionItem[],
  id: string,
  fn: (item: Extract<CollectionItem, { kind: 'request' }>) => CollectionItem,
): CollectionItem[] {
  return items.map((it) => {
    if (it.kind === 'request') return it.id === id ? fn(it) : it
    return { ...it, items: updateRequestIn(it.items, id, fn) }
  })
}

/** Rename a node in place (requests also sync their draft name). */function renameItem(items: CollectionItem[], id: string, name: string): CollectionItem[] {
  return items.map((it) => {
    if (it.id === id) {
      return it.kind === 'folder' ? { ...it, name } : { ...it, name, request: { ...it.request, name } }
    }
    return it.kind === 'folder' ? { ...it, items: renameItem(it.items, id, name) } : it
  })
}

/** All ids in a removed subtree (the node itself + descendants). */
function collectSubtree(items: CollectionItem[], id: string): CollectionItem | undefined {
  for (const it of items) {
    if (it.id === id) return it
    if (it.kind === 'folder') {
      const found = collectSubtree(it.items, id)
      if (found) return found
    }
  }
  return undefined
}

function idsOf(node: CollectionItem | undefined): Set<string> {
  const out = new Set<string>()
  const walk = (n: CollectionItem): void => {
    out.add(n.id)
    if (n.kind === 'folder') n.items.forEach(walk)
  }
  if (node) walk(node)
  return out
}

/** Detach a node (whole subtree) from the tree. */
function popNode(items: CollectionItem[], id: string): { items: CollectionItem[]; node: CollectionItem } | undefined {
  let popped: CollectionItem | undefined
  const walk = (list: CollectionItem[]): CollectionItem[] =>
    list.flatMap((it): CollectionItem[] => {
      if (it.id === id) {
        popped = it
        return []
      }
      return [it.kind === 'folder' ? { ...it, items: walk(it.items) } : it]
    })
  const next = walk(items)
  return popped ? { items: next, node: popped } : undefined
}

/** Position of a node: { collection-level or folder path and index in its parent list }. */
function locateNode(
  items: CollectionItem[],
  id: string,
  path: string[] = [],
): { folderIds: string[]; index: number } | undefined {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { folderIds: path, index: i }
    const it = items[i]
    if (it.kind === 'folder') {
      const found = locateNode(it.items, id, [...path, it.id])
      if (found) return found
    }
  }
  return undefined
}

/** Is parentId the node itself or a node inside its subtree? (drops that would vanish the tree) */
function livesInside(node: CollectionItem, parentId: string): boolean {
  if (node.id === parentId) return true
  return node.kind === 'folder' && node.items.some((c) => livesInside(c, parentId))
}

/** Insert node into a list: into folder (end) or at an index of the addressed list. */
function insertInto(items: CollectionItem[], node: CollectionItem, parentId: string | null, index: number | null): CollectionItem[] {
  if (parentId === null) {
    const at = index === null ? items.length : Math.max(0, Math.min(items.length, index))
    return [...items.slice(0, at), node, ...items.slice(at)]
  }
  return items.map((it) => {
    if (it.kind !== 'folder') return it
    if (it.id === parentId) {
      const at = index === null ? it.items.length : Math.max(0, Math.min(it.items.length, index))
      return { ...it, items: [...it.items.slice(0, at), node, ...it.items.slice(at)] }
    }
    return { ...it, items: insertInto(it.items, node, parentId, index) }
  })
}

/** Insert a node immediately after another node with the given id. */
function insertAfter(items: CollectionItem[], afterId: string, node: CollectionItem): CollectionItem[] {
  const out: CollectionItem[] = []
  for (const it of items) {
    out.push(it)
    if (it.id === afterId) out.push(node)
    else if (it.kind === 'folder') out[out.length - 1] = { ...it, items: insertAfter(it.items, afterId, node) }
  }
  return out
}

/** Deep copy for duplication: new ids everywhere, names get “ (copy)”. */
function duplicateSubtree(items: CollectionItem[], id: string): CollectionItem | undefined {
  const found = collectSubtree(items, id)
  if (!found) return undefined
  let counter = 0
  const copy = (n: CollectionItem): CollectionItem => {
    const newId = (n.kind === 'folder' ? 'fol' : 'req') + '-dup' + counter++ + Math.random().toString(36).slice(2, 8)
    if (n.kind === 'folder') {
      return { ...n, id: newId, name: n.name + ' (copy)', items: n.items.map(copy) }
    }
    return { ...n, id: newId, name: n.name + ' (copy)', request: { ...n.request, id: newId, name: n.name + ' (copy)' } }
  }
  return copy(found)
}

export const actions = {
  /** Load persisted stores from the main process on app start. */
  hydrate(): void {
    if (!pm) {
      appStore.set({ ready: true })
      return
    }
    void (async () => {
      try {
        const all = await pm.loadStores()
        appStore.set(toLoadedState(all))
      } catch (err) {
        appStore.set({ ready: true })
        actions.toast('Failed to load local data: ' + String((err as Error).message), 'error')
      }
    })()
  },

  /** Write all persistent slices to the main process (debounced via scheduleSave). */
  saveAll(): void {
    if (!pm) return
    const s = appStore.get()
    void pm.saveStore('collections', s.collections)
    void pm.saveStore('environments', { environments: s.environments, globals: s.globals })
    void pm.saveStore('history', s.history)
    void pm.saveStore('settings', s.settings)
    void pm.saveStore('tabs', { tabs: s.tabs, activeEnvId: s.activeEnvId } satisfies TabsBag)
  },

  // --- generic slices ---------------------------------------------------------

  /** Settings changes are infrequent and must persist even in manual mode, so they write immediately. */
  settings(patch: Partial<AppSettings>): void {
    // clamp numerics so hostile/buggy values can never reach the disk or the main process
    const num = (v: unknown, min: number, max: number, fallback: number | undefined): number | undefined => {
      if (v === undefined) return undefined
      const n = typeof v === 'number' && isFinite(v) ? Math.round(v) : NaN
      if (Number.isNaN(n)) return fallback
      return Math.min(max, Math.max(min, n))
    }
    const cur = appStore.get().settings
    const clamped: Partial<AppSettings> = { ...patch }
    const asNum = <K extends keyof AppSettings>(k: K, min: number, max: number): void => {
      const v = num(patch[k], min, max, cur[k] as number | undefined)
      if (v !== undefined) (clamped as Record<string, unknown>)[k as string] = v
      else delete (clamped as Record<string, unknown>)[k as string]
    }
    asNum('requestTimeoutMs', 0, 3600_000)
    asNum('maxResponseSizeMb', 0, 1024)
    asNum('historyLimit', 10, 5000)
    asNum('uiFontSize', 9, 28)
    asNum('editorFontSize', 8, 32)
    asNum('autosaveMs', 500, 600_000)
    asNum('tabSize', 1, 8)
    asNum('zoom', 50, 200)
    appStore.set((s) => ({ settings: { ...s.settings, ...clamped } }))
    actions.saveAll()
  },

  replaceCollections(next: Collection[]): void {
    appStore.set({ collections: next })
    scheduleSave()
  },

  replaceHistory(next: HistoryEntry[]): void {
    appStore.set({ history: next })
    scheduleSave()
  },

  // --- tab lifecycle ----------------------------------------------------------

  openTab(tab: OpenTab): void {
    appStore.set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    scheduleSave()
  },

  closeTab(tabId: string): void {
    appStore.set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return {}
      const tabs = s.tabs.slice()
      tabs.splice(idx, 1)
      const pending = { ...s.pending }
      const requestId = pending[tabId]
      delete pending[tabId]
      if (requestId && pm) void pm.cancelHttp(requestId)
      const responses = { ...s.responses }
      delete responses[tabId]
      const activeTabId =
        s.activeTabId === tabId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTabId
      return { tabs, pending, responses, activeTabId }
    })
    scheduleSave()
  },

  activateTab(tabId: string): void {
    appStore.set({ activeTabId: tabId })
    scheduleSave()
  },

  reorderTab(from: number, to: number): void {
    appStore.set((s) => {
      if (from === to || from < 0 || from >= s.tabs.length) return {}
      const tabs = s.tabs.slice()
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      return { tabs }
    })
    scheduleSave()
  },

  /** Clone the draft, mutate, mark dirty. Synchronous clone keeps typing latency low. */
  updateTab(tabId: string, mutate: (d: RequestDraft) => void): void {
    appStore.set((s) => {
      const t = s.tabs.find((x) => x.id === tabId)
      if (!t) return {}
      const draft: RequestDraft = JSON.parse(JSON.stringify(t.draft)) as RequestDraft
      mutate(draft)
      return { tabs: s.tabs.map((x) => (x.id === tabId ? { ...x, draft, dirty: true } : x)) }
    })
    scheduleSave()
  },

  markSaved(tabId: string, requestId: string, name: string, collectionId: string, folderIds: string[]): void {
    appStore.set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, requestId, name, collectionId, folderPath: folderIds, dirty: false } : t,
      ),
    }))
    scheduleSave()
  },

  renameTab(tabId: string, name: string): void {
    appStore.set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, name, dirty: true } : t)),
    }))
    scheduleSave()
  },

  newTab(prefill?: Partial<RequestDraft>): void {
    const id = 'tab-' + uid()
    const draft = JSON.parse(JSON.stringify({ ...DEFAULT_REQUEST, ...prefill })) as RequestDraft
    actions.openTab({ id, name: hostOf(draft.url) || 'Untitled', draft, dirty: false })
  },

  // --- collections ------------------------------------------------------------

  createCollection(name: string): Collection {
    const col: Collection = { id: 'col-' + uid(), name: (name.trim() || 'New Collection'), items: [] }
    appStore.set((s) => ({ collections: [...s.collections, col] }))
    scheduleSave()
    return col
  },

  renameCollection(collectionId: string, name: string): void {
    appStore.set((s) => ({
      collections: s.collections.map((c) => (c.id === collectionId ? { ...c, name } : c)),
    }))
    scheduleSave()
  },

  deleteCollection(collectionId: string): void {
    appStore.set((s) => ({ collections: s.collections.filter((c) => c.id !== collectionId) }))
    scheduleSave()
  },

  patchCollectionItems(collectionId: string, next: CollectionItem[]): void {
    appStore.set((s) => ({
      collections: s.collections.map((c) => (c.id === collectionId ? { ...c, items: next } : c)),
    }))
    scheduleSave()
  },

  /**
   * One-click save, no dialog: an already-saved request updates in place
   * (keeping its folder); a new one lands in the last-used (or first)
   * collection root — creating “My Collection” when none exists.
   * The ⋯ caret next to Save still opens “Save as…” for moving between folders.
   */
  saveActiveRequest(tabId: string): void {
    const s = appStore.get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const draft = JSON.parse(JSON.stringify(tab.draft)) as RequestDraft
    const name = (draft.name ?? '').trim() || hostOf(draft.url) || 'Untitled'

    let collections = s.collections
    let colId =
      tab.collectionId && collections.some((c) => c.id === tab.collectionId)
        ? tab.collectionId
        : (collections[0]?.id ?? null)
    if (!colId) {
      const seeded: Collection = { id: 'col-' + uid(), name: 'My Collection', items: [] }
      collections = [...collections, seeded]
      colId = seeded.id
    }

    const colIdx = collections.findIndex((c) => c.id === colId)
    if (colIdx < 0) return
    const col = collections[colIdx]
    const anchor = tab.requestId ? locateNode(col.items, tab.requestId) : undefined

    let items: CollectionItem[]
    let requestId: string
    if (anchor && tab.requestId) {
      requestId = tab.requestId
      items = updateRequestIn(col.items, requestId, (it) => ({
        ...it,
        name,
        request: { ...draft, id: it.request.id, name },
      }))
    } else {
      requestId = 'req-' + uid()
      const item: CollectionItem = { id: requestId, kind: 'request', name, request: { ...draft, id: requestId, name } }
      items = insertInto(col.items, item, null, null)
    }

    const nextCols = collections.map((c, i) => (i === colIdx ? { ...c, items } : c))
    const folderIds = locateNode(items, requestId)?.folderIds ?? []
    appStore.set({
      collections: nextCols,
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, requestId, name, collectionId: colId, folderPath: folderIds, dirty: false } : t,
      ),
    })
    actions.toast(anchor ? 'Request updated' : `Saved to “${col.name}”`, 'success')
    scheduleSave()
  },

  /** Rename a request or folder inside a collection; keeps open tabs in sync. */
  renameCollectionItem(collectionId: string, itemId: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    appStore.set((s) => ({
      collections: s.collections.map((c) =>
        c.id === collectionId ? { ...c, items: renameItem(c.items, itemId, trimmed) } : c,
      ),
      tabs: s.tabs.map((t) =>
        t.requestId === itemId && t.collectionId === collectionId
          ? { ...t, name: trimmed, draft: { ...t.draft, name: trimmed } }
          : t,
      ),
    }))
    scheduleSave()
  },

  /** Delete a request or folder (with its subtree); closes tabs that used it. */
  deleteCollectionItem(collectionId: string, itemId: string): void {
    const col = appStore.get().collections.find((c) => c.id === collectionId)
    if (!col) return
    const goneIds = idsOf(collectSubtree(col.items, itemId))
    appStore.set((s) => {
      const tabs = s.tabs.filter((t) => !(t.collectionId === collectionId && t.requestId && goneIds.has(t.requestId)))
      const activeTabId =
        s.activeTabId && !tabs.some((t) => t.id === s.activeTabId) ? (tabs[0]?.id ?? null) : s.activeTabId
      return {
        collections: s.collections.map((c) => (c.id === collectionId ? { ...c, items: removeItem(c.items, itemId) } : c)),
        tabs,
        activeTabId,
      }
    })
    scheduleSave()
  },

  /** Deep-copy a request or folder inside the same collection, right after the original. */
  duplicateCollectionItem(collectionId: string, itemId: string): void {
    const col = appStore.get().collections.find((c) => c.id === collectionId)
    if (!col) return
    const dup = duplicateSubtree(col.items, itemId)
    if (!dup) return
    appStore.set((s) => ({
      collections: s.collections.map((c) => (c.id === collectionId ? { ...c, items: insertAfter(c.items, itemId, dup) } : c)),
    }))
    scheduleSave()
  },

  /**
   * Move a request or folder to another position/collection.
   * toParentId null = collection root; toIndex null = append at end of that list.
   */
  moveCollectionItem(fromColId: string, itemId: string, toColId: string, toParentId: string | null, toIndex: number | null): void {
    if (fromColId === toColId) {
      const col = appStore.get().collections.find((c) => c.id === fromColId)
      if (!col) return
      const popped = popNode(col.items, itemId)
      if (!popped) return
      if (toParentId !== null && livesInside(popped.node, toParentId)) return // cannot drop into itself/own subtree
      const next = insertInto(popped.items, popped.node, toParentId, toIndex) // null/null appends at root
      // hostile or stale drop targets must never make the node vanish — fall back to the root list
      const finalItems = locateNode(next, popped.node.id)
        ? next
        : insertInto(popped.items, popped.node, null, toIndex)
      appStore.set((s) => ({
        collections: s.collections.map((c) => (c.id === fromColId ? { ...c, items: finalItems } : c)),
      }))
    } else {
      const cols = appStore.get().collections
      const from = cols.find((c) => c.id === fromColId)
      const to = cols.find((c) => c.id === toColId)
      if (!from || !to) return
      const popped = popNode(from.items, itemId)
      if (!popped) return
      let nextTo = insertInto(to.items, popped.node, toParentId, toIndex)
      // same guarantee cross-collection: a missing folder target would lose the node
      if (!locateNode(nextTo, popped.node.id)) {
        nextTo = insertInto(to.items, popped.node, null, toIndex)
      }
      appStore.set((s) => ({
        collections: s.collections.map((c) =>
          c.id === fromColId ? { ...c, items: popped.items } : c.id === toColId ? { ...c, items: nextTo } : c,
        ),
      }))
    }
    // re-align every tab that references a saved request with its new location
    const after = appStore.get().collections
    appStore.set((s) => ({
      tabs: s.tabs.map((t) => {
        if (!t.requestId) return t
        for (const c of after) {
          const loc = locateNode(c.items, t.requestId)
          if (loc) return { ...t, collectionId: c.id, folderPath: loc.folderIds }
        }
        return t
      }),
    }))
    scheduleSave()
  },

  // --- environments -----------------------------------------------------------

  createEnvironment(name: string): Environment {
    const env: Environment = { id: 'env-' + uid(), name: (name.trim() || 'New Environment'), variables: [] }
    appStore.set((s) => ({ environments: [...s.environments, env] }))
    scheduleSave()
    return env
  },

  renameEnvironment(envId: string, name: string): void {
    appStore.set((s) => ({
      environments: s.environments.map((e) => (e.id === envId ? { ...e, name } : e)),
    }))
    scheduleSave()
  },

  deleteEnvironment(envId: string): void {
    appStore.set((s) => ({
      environments: s.environments.filter((e) => e.id !== envId),
      activeEnvId: s.activeEnvId === envId ? null : s.activeEnvId,
    }))
    scheduleSave()
  },

  setEnvVars(envId: string, variables: EnvVar[]): void {
    appStore.set((s) => ({
      environments: s.environments.map((e) => (e.id === envId ? { ...e, variables } : e)),
    }))
    scheduleSave()
  },

  setGlobals(globals: EnvVar[]): void {
    appStore.set({ globals })
    scheduleSave()
  },

  setActiveEnv(id: string | null): void {
    appStore.set({ activeEnvId: id })
  },

  // --- history ----------------------------------------------------------------

  deleteHistoryEntry(id: string): void {
    appStore.set((s) => ({ history: s.history.filter((h) => h.id !== id) }))
    scheduleSave()
  },

  clearHistory(): void {
    appStore.set({ history: [] })
    scheduleSave()
  },

  // --- send / cancel ----------------------------------------------------------

  send(tabId: string): void {
    const s = appStore.get()
    const tab = s.tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (s.pending[tabId]) return
    const requestId = 'req-' + uid()
    const started = Date.now()
    appStore.set((st) => ({
      pending: { ...st.pending, [tabId]: requestId },
      scriptLogs: { ...st.scriptLogs, [tabId]: [] },
      testResults: { ...st.testResults, [tabId]: [] },
    }))
    void execute(tabId, tab, requestId, started)
  },

  cancel(tabId: string): void {
    const s = appStore.get()
    const requestId = s.pending[tabId]
    if (!requestId) return
    if (pm) void pm.cancelHttp(requestId)
    appStore.set((st) => {
      const pending = { ...st.pending }
      delete pending[tabId]
      return { pending }
    })
  },

  // --- ui ---------------------------------------------------------------------

  setPanel(panel: AppStoreState['panel']): void {
    appStore.set({ panel })
  },

  toggleConsole(): void {
    appStore.set((s) => ({ consoleOpen: !s.consoleOpen }))
  },

  setSidebarWidth(px: number): void {
    appStore.set({ sidebarWidth: Math.min(560, Math.max(200, px)) })
  },

  toggleSidebar(): void {
    const w = appStore.get().sidebarWidth
    if (w === 0) appStore.set({ sidebarWidth: lastSidebarWidth })
    else {
      lastSidebarWidth = w
      appStore.set({ sidebarWidth: 0 })
    }
  },

  openModal(modal: ModalName): void {
    appStore.set((s) => ({ modals: { ...s.modals, [modal]: true } }))
  },

  closeModal(modal: ModalName): void {
    appStore.set((s) => {
      const m = { ...s.modals }
      delete m[modal]
      return { modals: m }
    })
  },

  toast(text: string, kind: 'info' | 'error' | 'success' = 'info'): void {
    const id = toastSeq++
    appStore.set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => {
      appStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4200)
  },
}

// --- request execution -------------------------------------------------------

/** Union matching the bridge contract; discriminated on send by property presence. */
type HttpSendResult =
  | {
      requestId: string
      status: number
      statusText: string
      headers: { key: string; value: string }[]
      body: string | null
      bodyBytes: number
      truncated: boolean
      durationMs: number
      contentType: string
    }
  | {
      requestId: string
      code: string
      message: string
      durationMs: number
    }

function clearPending(tabId: string): void {
  appStore.set((st) => {
    const pending = { ...st.pending }
    delete pending[tabId]
    return { pending }
  })
}

function setResponse(tabId: string, resp: ResponseState): void {
  appStore.set((st) => ({ responses: { ...st.responses, [tabId]: resp } }))
}

function pushHistory(entry: HistoryEntry): void {
  appStore.set((st) => {
    const limit = Math.max(10, st.settings.historyLimit)
    return { history: [entry, ...st.history].slice(0, limit) }
  })
  scheduleSave()
}

function finishWithTransportError(
  tabId: string,
  requestId: string,
  started: number,
  code: string,
  message: string,
): void {
  clearPending(tabId)
  setResponse(tabId, {
    requestId,
    failError: message,
    errorCode: code,
    headers: [],
    body: null,
    bodyBytes: 0,
    truncated: false,
    durationMs: Math.max(1, Date.now() - started),
    contentType: '',
    sentAt: started,
  })
}

async function execute(tabId: string, tab: OpenTab, requestId: string, started: number): Promise<void> {
  if (!pm) {
    finishWithTransportError(tabId, requestId, started, 'NO_BRIDGE', 'Requests require the Postmaster desktop shell.')
    return
  }

  const s = appStore.get()
  let draft = tab.draft

  // scope snapshot for scripts; refreshed after a pre-script mutates it
  const freshScope = (): VarScope => {
    const st = appStore.get()
    const activeEnv = st.environments.find((e) => e.id === st.activeEnvId) ?? null
    return {
      globals: varsToScope(st.globals),
      environment: activeEnv ? varsToScope(activeEnv.variables) : undefined,
      runtime: draft.runtimeVars,
    }
  }

  // --- pre-request script ------------------------------------------------------
  const preScript = draft.scripts?.pre?.trim()
  if (preScript) {
    const run = await runScriptSafely(draft, preScript, freshScope(), undefined)
    if (!run) {
      finishWithTransportError(tabId, requestId, started, 'NO_BRIDGE', 'Requests require the Postmaster desktop shell.')
      return
    }
    appendLogs(tabId, run.logs)
    applyScriptVars(tabId, run.globalSets, run.envSets, run.collectionSets)
    if (run.error) {
      // a failing pre-request script aborts the send (matches Postman's default)
      finishWithTransportError(tabId, requestId, started, 'SCRIPT', run.error)
      return
    }
    // adopt newer runtime vars / draft edits made while scripts ran
    draft = appStore.get().tabs.find((t) => t.id === tabId)?.draft ?? draft
  }

  // --- send --------------------------------------------------------------------
  const result = (await pm.sendHttp({
    requestId,
    draft,
    scope: freshScope(),
    defaults: {
      timeoutMs: draft.settings.timeoutMs > 0 ? draft.settings.timeoutMs : s.settings.requestTimeoutMs,
      maxResponseSizeMb: s.settings.maxResponseSizeMb,
      sslVerify: s.settings.sslVerify,
      disableCookies: s.settings.disableCookies,
      proxy: s.settings.proxy,
    },
  }) as HttpSendResult)

  // transport-level error (no HTTP status present)
  if (!('status' in result)) {    finishWithTransportError(tabId, requestId, started, result.code, result.message)
    // failure history entry preserves the attempt
    pushHistory({
      id: requestId,
      ts: started,
      name: tab.name,
      method: draft.method,
      url: draft.url,
      error: `${result.code}: ${result.message}`,
    })
    return
  }

  // --- post-response script ----------------------------------------------------
  const resp = {
    code: result.status,
    status: result.statusText,
    responseTime: result.durationMs,
    headers: result.headers,
    sizeBytes: result.bodyBytes,
    body: result.body,
    contentType: result.contentType,
  }
  const postScript = draft.scripts?.post?.trim()
  if (postScript) {
    const run = await runScriptSafely(draft, postScript, freshScope(), resp)
    if (run) {
      appendLogs(tabId, run.logs)
      appStore.set((st) => ({ testResults: { ...st.testResults, [tabId]: run.tests } }))
      applyScriptVars(tabId, run.globalSets, run.envSets, run.collectionSets)
    }
  }

  // --- present -----------------------------------------------------------------
  clearPending(tabId)
  setResponse(tabId, {
    requestId,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    body: result.body,
    bodyBytes: result.bodyBytes,
    truncated: result.truncated,
    durationMs: result.durationMs,
    contentType: result.contentType,
    sentAt: started,
  })
  pushHistory({
    id: requestId,
    ts: started,
    name: tab.name,
    method: draft.method,
    url: draft.url,
    response: {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers.slice(0, 50),
      bodyTruncated: result.truncated,
      body: result.body && result.body.length <= 262_144 ? result.body : null,
      bodyEncoding: 'text',
      durationMs: result.durationMs,
      sizeBytes: result.bodyBytes,
      contentType: result.contentType,
    },
  })
}

function appendLogs(tabId: string, logs: ScriptLogEntry[]): void {
  if (!logs.length) return
  appStore.set((st) => ({
    scriptLogs: { ...st.scriptLogs, [tabId]: (st.scriptLogs[tabId] ?? []).concat(logs) },
  }))
}

/** Run a script through the main-process sandbox; null when no bridge / IPC failure. */
function runScriptSafely(
  draft: RequestDraft,
  script: string,
  scope: VarScope,
  response:
    | {
        code: number
        status: string
        responseTime: number
        headers: { key: string; value: string }[]
        sizeBytes: number
        body: string | null
        contentType: string
      }
    | undefined,
): Promise<
  | {
      logs: ScriptLogEntry[]
      tests: TestResult[]
      envSets: Record<string, string>
      globalSets: Record<string, string>
      collectionSets: Record<string, string>
      error?: string
    }
  | null
> {
  if (!pm) return Promise.resolve(null)
  const headers: Record<string, string> = {}
  for (const h of draft.headers) {
    if (h.enabled && h.key) headers[h.key] = h.value
  }
  const context: Record<string, unknown> = {
    variables: {
      globals: scope.globals ?? {},
      environment: scope.environment ?? {},
      collection: scope.runtime ?? {},
    },
    request: {
      method: draft.method,
      url: draft.url,
      headers,
      body: bodyPreview(draft),
    },
  }
  if (response) context.response = response
  return pm
    .runScript({ script, timeoutMs: 2500, context })
    .then((r) => ({
      logs: r.logs,
      tests: r.tests,
      envSets: r.envSets,
      globalSets: r.globalSets,
      collectionSets: r.collectionSets,
      error: r.error,
    }))
    .catch(() => null)
}

function bodyPreview(d: RequestDraft): string | undefined {
  switch (d.body.type) {
    case 'json':
      return d.body.json
    case 'raw':
      return d.body.raw
    case 'urlencoded':
      return d.body.urlencoded
        .filter((p) => p.enabled)
        .map((p) => `${p.key}=${p.value}`)
        .join('&')
    default:
      return undefined
  }
}

/** Persist variables written by scripts (pre/post) to env/global/runtime stores. */
function applyScriptVars(
  tabId: string,
  globalSets?: Record<string, string>,
  envSets?: Record<string, string>,
  collectionSets?: Record<string, string>,
): void {
  const appliedGlobals = sanitizeSets(globalSets)
  const appliedEnv = sanitizeSets(envSets)
  const appliedRuntime = sanitizeSets(collectionSets)
  const hasGlobals = Object.keys(appliedGlobals).length > 0
  const hasEnv = Object.keys(appliedEnv).length > 0
  const hasRuntime = Object.keys(appliedRuntime).length > 0
  if (!hasGlobals && !hasEnv && !hasRuntime) return

  appStore.set((st) => {
    const patch: Partial<AppStoreState> = {}
    if (hasRuntime) {
      const idx = st.tabs.findIndex((t) => t.id === tabId)
      if (idx >= 0) {
        const t = st.tabs[idx]
        const tabs = st.tabs.slice()
        tabs[idx] = {
          ...t,
          draft: { ...t.draft, runtimeVars: { ...(t.draft.runtimeVars ?? {}), ...appliedRuntime } },
        }
        patch.tabs = tabs
      }
    }
    if (hasEnv && st.activeEnvId) {
      patch.environments = st.environments.map((e) =>
        e.id === st.activeEnvId ? { ...e, variables: mergeVarsInto(e.variables, appliedEnv) } : e,
      )
    }
    if (hasGlobals) {
      patch.globals = mergeVarsInto(st.globals, appliedGlobals)
    }
    return patch
  })
  scheduleSave()
}

/** Filter out non-string values and empty keys before applying. */
function sanitizeSets(sets?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!sets) return out
  for (const [k, v] of Object.entries(sets)) {
    if (typeof v === 'string' && k.trim()) out[k.trim()] = v
  }
  return out
}

function mergeVarsInto(list: EnvVar[], newVars: Record<string, string>): EnvVar[] {
  const next = list.map((v) => ({ ...v }))
  for (const [k, v] of Object.entries(newVars)) {
    const idx = next.findIndex((x) => x.key === k)
    if (idx >= 0) next[idx] = { ...next[idx], value: v }
    else next.push({ id: 'var-' + uid(), key: k, value: v, secret: false })
  }
  return next
}
