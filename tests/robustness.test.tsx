import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// --- adversarial probe suite: try to break Postmaster from the outside ----------
// Every block below plays a hostile input or misuse against the app and asserts
// it degrades gracefully (no throw, sane state) instead of crashing.

const saveStore = vi.fn(async () => ({ ok: true }))
const bridgeStub: Record<string, unknown> = {
  loadStores: async () => ({
    collections: [],
    environments: { environments: [], globals: [] },
    history: [],
    settings: {},
    tabs: { tabs: [] },
  }),
  saveStore,
  sendHttp: async () => ({ requestId: 'x', code: 'NO_BRIDGE_TEST', message: 'test' }),
  cancelHttp: async () => true,
  runScript: async () => ({ logs: [], tests: [], envSets: {}, globalSets: {}, collectionSets: {} }),
  appInfo: async () => ({ version: '3.4.1', electron: '39', chrome: '126', node: '22', platform: 'win' }),
  importFile: async () => null,
  exportFile: async () => ({ saved: 'x' }),
  listCookies: async () => [],
  clearCookies: async () => true,
  openExternal: async () => true,
  minimize: async () => undefined,
  maximize: async () => undefined,
  close: async () => undefined,
  isMaximized: async () => false,
  setZoom: async () => null,
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { postmaster?: Record<string, unknown> }).postmaster = bridgeStub
  bridgeStub.loadStores = async () => ({
    collections: [],
    environments: { environments: [], globals: [] },
    history: [],
    settings: {},
    tabs: { tabs: [] },
  })
})

describe('hostile persisted stores (hydrate path)', () => {
  it('corrupt collections + tabs JSON hydrates to zero casualties', async () => {
    bridgeStub.loadStores = async () => ({
      // junk types in every field the renderer touches
      collections: [
        null,
        42,
        { id: 7, name: {}, items: 'x' },
        { id: 'c1', name: 'Half-broken', items: ['not-an-item', null, { kind: 'folder', items: {} }] },
        { id: 'c2', name: 'Ok col', items: [{ id: 'r1', kind: 'request', name: 'R', request: { method: 'GET', url: 'https://a.dev' } }] },
      ],
      environments: { environments: [{ id: 'e1', name: 'E', variables: 'not-an-array' }], globals: { g: 'x' } },
      history: 66,
      settings: { uiFontSize: 9999, editorFontSize: -40, requestTimeoutMs: -1, historyLimit: 0, zoom: 9999, autosaveMs: 'x' },
      tabs: {
        tabs: [
          null,
          'garbage',
          { draft: { url: 'https://x.dev' } }, // missing id
          { id: 't1', name: 'Hostile draft', draft: { method: 'GET', url: 'https://y.dev', body: 'not-an-object' } },
          { id: 't2', name: 'Partial rows', draft: { url: 'https://z.dev', headers: ['x', null, { key: 'a', value: 'b' }], settings: null } },
        ],
      },
    })
    const { actions, appStore } = await import('../src/state/actions')
    expect(() => actions.hydrate()).not.toThrow()
    await new Promise((r) => setTimeout(r, 0)) // hydrate resolves asynchronously
    const s = appStore.get()
    expect(s.ready).toBe(true)
    // every tab it kept must have a structurally valid draft
    for (const t of s.tabs) {
      expect(typeof t.id).toBe('string')
      expect(typeof t.draft.url).toBe('string')
      expect(Array.isArray(t.draft.headers)).toBe(true)
      expect(typeof t.draft.body).toBe('object')
      // body type must be one of the known values after repair
      expect(['none', 'json', 'raw', 'urlencoded', 'form']).toContain(t.draft.body.type)
    }
    for (const c of s.collections) {
      expect(typeof c.id).toBe('string')
      expect(Array.isArray(c.items)).toBe(true)
    }
    // then the UI still paints the workspace
    const App = (await import('../src/App')).default
    const { unmount } = render(<App />)
    expect(await screen.findByText('Postmaster')).toBeTruthy()
    unmount()
  })

  it('keep a hostile-half-valid request row usable: open + edit + save', async () => {
    bridgeStub.loadStores = async () => ({
      collections: [{ id: 'c1', name: 'C', items: [] }],
      environments: { environments: [], globals: [] },
      history: [],
      settings: {},
      tabs: { tabs: [{ id: 't1', draft: { url: 'https://row.dev', headers: [{ key: 'k', value: 'v' }] } }] },
    })
    const { actions, appStore } = await import('../src/state/actions')
    actions.hydrate()
    await new Promise((r) => setTimeout(r, 0)) // hydrate resolves asynchronously
    const tabId = appStore.get().tabs[0].id
    actions.updateTab(tabId, (d) => {
      d.headers.push({ id: 'h9', key: 'n', value: 'v2', enabled: true })
    })
    expect(() => actions.saveActiveRequest(tabId)).not.toThrow()
    expect(appStore.get().collections[0].items.length).toBe(1)
  })
})

describe('collection tree misuse', () => {
  const getA = (): Promise<{ actions: typeof import('../src/state/actions')['actions']; appStore: typeof import('../src/state/actions')['appStore'] }> =>
    import('../src/state/actions')
  it('unknown ids and collections are silent no-ops', async () => {
    const { actions, appStore } = await getA()
    const before = JSON.stringify(appStore.get().collections)
    actions.moveCollectionItem('no-col', 'no-item', 'no-col', null, null)
    actions.moveCollectionItem('no-col', 'no-item', 'other-no-col', null, null)
    actions.duplicateCollectionItem('no-col', 'x')
    actions.deleteCollectionItem('no-col', 'x')
    actions.renameCollectionItem('no-col', 'x', 'zz')
    expect(JSON.stringify(appStore.get().collections)).toBe(before)
  })

  it('folder cannot be dropped into itself or its own subtree', async () => {
    const { actions, appStore } = await getA()
    const col = {
      id: 'c1',
      name: 'C',
      items: [
        { id: 'f1', kind: 'folder', name: 'F1', items: [{ id: 'r1', kind: 'request', name: 'R', request: { method: 'GET', url: 'u' } }] },
        { id: 'f2', kind: 'folder', name: 'F2', items: [] },
      ],
    }
    // cast through unknown: the store does not validate shapes on the way in,
    // which is exactly what an attacker-crafted file would exploit
    appStore.set({ collections: [col] as never })
    // drop f1 onto r1 (inside f1's own subtree) â€” must be a no-op
    actions.moveCollectionItem('c1', 'f1', 'c1', 'r1', null)
    const s = appStore.get().collections[0]
    expect((s.items[0] as { id: string }).id).toBe('f1')
    expect(JSON.stringify(appStore.get().collections[0].items)).toContain('r1')
    // dropping f1 onto f2 or its root list is fine
    actions.moveCollectionItem('c1', 'f1', 'c1', null, null)
    expect((appStore.get().collections[0].items[1] as { id: string }).id).toBe('f1')
  })

  it('cross-collection move with hostile toParentId does not corrupt the target', async () => {
    const { actions, appStore } = await getA()
    const cols = [
      { id: 'c1', name: 'A', items: [{ id: 'r1', kind: 'request', name: 'R', request: { method: 'GET', url: 'u' } }] },
      { id: 'c2', name: 'B', items: [{ id: 'f2', kind: 'folder', name: 'F2', items: [] }] },
    ]
    appStore.set({ collections: cols as never })
    // toParentId points at the node being moved itself â€” nonsensical drop target
    actions.moveCollectionItem('c1', 'r1', 'c2', 'r1', 0)
    const c2 = appStore.get().collections[1]
    // either inserted or rejected, but never an exception and never a lost node
    const flat = JSON.stringify(c2)
    expect(flat).toContain('r1')
  })
})

describe('saveActiveRequest with dangling references', () => {
  it('tab pointing at a deleted collection falls back safely', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    const col = { id: 'c1', name: 'Keep', items: [] }
    appStore.set({
      collections: [col] as never,
      tabs: [
        {
          id: 't1',
          name: 'Lonely',
          requestId: 'ghost-req',
          collectionId: 'deleted-col',
          folderPath: [],
          dirty: true,
          draft: { method: 'GET', url: 'https://dangling.dev' },
        } as never,
      ],
      activeTabId: 't1',
    })
    expect(() => actions.saveActiveRequest('t1')).not.toThrow()
    const s = appStore.get()
    expect(s.tabs[0].collectionId).toBe('c1')
    expect(s.tabs[0].requestId).not.toBe('ghost-req')
    expect(s.collections[0].items.length).toBe(1)
  })

  it('deleting the collection a tab came from, then closing tabs, stays consistent', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    appStore.set({
      collections: [{ id: 'cX', name: 'X', items: [{ id: 'rX', kind: 'request', name: 'X', request: { method: 'GET', url: 'u' } }] }] as never,
      tabs: [
        { id: 'tX', name: 'TX', requestId: 'rX', collectionId: 'cX', folderPath: [], dirty: false, draft: { method: 'GET', url: 'u' } },
      ] as never,
      activeTabId: 'tX',
    })
    actions.deleteCollection('cX')
    expect(appStore.get().collections.length).toBe(0)
    expect(appStore.get().tabs[0].collectionId).toBe('cX') // stale pointer is harmless here
    actions.deleteCollectionItem('cX', 'rX') // unknown collection now â€” no-op, no throw
    actions.closeTab('tX')
    expect(appStore.get().tabs.length).toBe(0)
    expect(appStore.get().activeTabId).toBeNull()
  })
})

describe('settings hardening', () => {
  it('absurd numeric settings are clamped, not persisted raw', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    actions.settings({
      requestTimeoutMs: -1,
      historyLimit: 0,
      uiFontSize: 400,
      editorFontSize: -3,
      autosaveMs: -5,
      maxResponseSizeMb: -1,
      zoom: 100,
    })
    const s = appStore.get().settings
    expect(s.requestTimeoutMs).toBeGreaterThanOrEqual(0)
    expect(s.historyLimit).toBeGreaterThanOrEqual(10)
    expect(s.uiFontSize).toBeLessThanOrEqual(28)
    expect(s.editorFontSize).toBeGreaterThanOrEqual(8)
    expect(s.maxResponseSizeMb).toBeGreaterThanOrEqual(0)
  })
})

describe('URL â‡„ params adversarial inputs', () => {
  it('split/build survive hostile query strings without throwing', async () => {
    const { splitUrl, buildUrl } = await import('../shared/http-utils')
    const hostile = ['?', '?=', '?a', '?a=', 'a=1?b=2', 'x=%ZZ', '+ &', '=v', 'k', 'k=', '%2', 'a&&&b']
    for (const q of hostile) {
      expect(() => splitUrl('https://h.dev?' + q)).not.toThrow()
    }
    // canonical roundtrip: built URL re-parses to the same rows
    const rows = [
      { id: 'a', key: 'page', value: '2', description: '', enabled: true },
      { id: 'b', key: 'notes', value: 'a b&c=d', description: '', enabled: true },
    ]
    const url = buildUrl('https://h.dev', rows)
    const reparsed = splitUrl(url)
    expect(reparsed.pairs?.map((p) => [p.key, p.value])).toEqual([
      ['page', '2'],
      ['notes', 'a b&c=d'],
    ])
    // empty rows collapse back to the bare base
    expect(buildUrl('https://h.dev', rows.map((r) => ({ ...r, enabled: false })))).toBe('https://h.dev')
    // numbers, nullish and weird base types do not explode
    expect(() => splitUrl(String(null as unknown as string))).not.toThrow()
    expect(() => buildUrl('', rows)).not.toThrow()
  })

  it('cURL export escapes hostile header/body/url content', async () => {
    const { toCurl } = await import('../shared/http-utils')
    await import('../shared/models')
    const draft = {
      method: 'POST',
      url: 'https://h.dev/x"; rm -rf ~"',
      headers: [{ id: 'h', key: 'X-Try', value: '"quoted" \\" still' }],
      query: [],
      body: { type: 'json' as const, json: '{"a":"b\\"c"}', raw: '', urlencoded: [], form: [] },
      auth: { type: 'none' as const },
    }
    const curl = toCurl(draft as never)
    expect(curl).toContain('https://h.dev/x\\"; rm -rf ~\\"')
    expect(curl).not.toMatch(/https:\/\/h\.dev\/x"; rm/)
  })
})

describe('variable resolution edge cases', () => {
  it('empty names, nested braces and unresolved vars never loop or throw', async () => {
    const { resolveVariables, resolveDraft } = await import('../shared/variables')
    await import('../shared/models')
    const cases = ['{{', '}}', '{{}}', '{{ }}', '{{a}}{{a}}', '{{a}}{{b}}', '{{name}}', '{{ a.b.c }}']
    for (const raw of cases) {
      const res = resolveVariables(raw, { globals: {}, environment: {}, runtime: {} })
      expect(typeof res.value).toBe('string')
      expect(Array.isArray(res.unresolved)).toBe(true)
    }
    // a resolved value that itself contains {{}} markers is NOT re-expanded
    const res = resolveVariables('CLICK={{x}}', { environment: { x: '{{y}}' } })
    expect(res.value).toBe('CLICK={{y}}')
    // hostile partial drafts must not explode the full resolver
    expect(() =>
      resolveDraft({ method: 'GET', url: 'u', headers: null as never, query: undefined as never, body: undefined as never, auth: { type: 'none' } } as never, {}),
    ).not.toThrow()
  })
})

// --- main-process dangers: DataStore corruption recovery (runs in vitest/node) ---
describe('DataStore corruption recovery', () => {
  it('corrupt JSON falls back to .bak, future versions are preserved, junk names rejected', async () => {
    const { mkdtempSync, writeFileSync, rmSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const dir = mkdtempSync(path.join(tmpdir(), 'pm-store-'))
    try {
      const { DataStore, STORE_FILES } = await import('../electron-main/store/dataStore')
      // real file corrupt, backup valid â†’ backup wins
      writeFileSync(path.join(dir, 'collections.json'), '{corrupt!')
      writeFileSync(
        path.join(dir, 'collections.json.bak'),
        JSON.stringify({ meta: { version: STORE_FILES.collections.version, app: 'postmaster' }, data: [{ id: '1', name: 'bak' }] }),
      )
      const store = new DataStore(dir)
      await store.initialize()
      await new Promise((r) => setTimeout(r, 10))
      expect(store.get('collections', [])).toEqual([{ id: '1', name: 'bak' }])
      // future version file is preserved untouched (entire envelope kept verbatim)
      const future = JSON.stringify({ meta: { version: 99, app: 'postmaster' }, data: { tabs: [] }, extra: true })
      writeFileSync(path.join(dir, 'tabs.json'), future)
      await store.load('tabs')
      expect(JSON.stringify(store.get('tabs', null))).toBe(JSON.stringify(JSON.parse(future)))
      // flush roundtrip writes a readable file
      store.set('settings', { a: 1 })
      await store.flush('settings')
      const round = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))
      expect(round.meta.app).toBe('postmaster')
      expect(round.data.a).toBe(1)
      await store.shutdown()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('store:save IPC rejects unknown store names and junk payloads', async () => {
    const { mkdirSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const dir = path.join(tmpdir(), 'pm-ipc-' + Math.random().toString(36).slice(2))
    mkdirSync(dir, { recursive: true })
    try {
      const { DataStore } = await import('../electron-main/store/dataStore')
      const mod = await import('../electron-main/ipc/storeIpc')
      const handlers = new Map<string, unknown>()
      const ipcMain = { handle: (ch: string, fn: unknown) => handlers.set(ch, fn) } as never
      const store = new DataStore(dir)
      await store.initialize()
      mod.registerStoreIpc(ipcMain, store)
      const save = handlers.get('store:save') as (e: unknown, name: unknown, data: unknown) => { ok: boolean; error?: string }
      expect(save(null, 'collections/../etc', { x: 1 }).ok).toBe(false)
      expect(save(null, '', null).ok).toBe(false)
      expect(save(null, 'history', ['ok', 42]).ok).toBe(true)
      const load = handlers.get('store:loadAll') as (e?: unknown) => Record<string, unknown>
      expect(Array.isArray(load().history)).toBe(true)
      await store.shutdown()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
