import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// ---- bridge stub (window.postmaster) ----------------------------------------
// One persistent object: api/bridge.ts captures `window.postmaster` at module
// load, so tests must MUTATE this object rather than replace it.

const saveStore = vi.fn(async (_name: string, _data: unknown) => ({ ok: true }))
const bridgeStub: Record<string, unknown> = {
  loadStores: async () => ({
    collections: [],
    environments: { environments: [], globals: [] },
    history: [],
    settings: {},
    tabs: { tabs: [] },
  }),
  saveStore,
  sendHttp: async () => ({ requestId: 'x', code: 'NO_BRIDGE_TEST', message: 'test', durationMs: 1 }),
  cancelHttp: async () => true,
  runScript: async () => ({ logs: [], tests: [], envSets: {}, globalSets: {}, collectionSets: {}, durationMs: 1 }),
  appInfo: async () => ({ version: '0.1.0', electron: '39', chrome: '126', node: '22', platform: 'win' }),
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
})

describe('App shell', () => {
  it('renders titlebar, sidebar and empty workspace after hydrate', async () => {
    const App = (await import('../src/App')).default
    const { unmount } = render(<App />)
    expect(await screen.findByText('Postmaster')).toBeTruthy()
    expect(await screen.findByText(/Nothing open/)).toBeTruthy()
    unmount()
  })

  it('restores persisted collections and tabs from the stores (normalizeDraft fills missing fields)', async () => {
    // point the bridge stub at persisted data with a *partial* draft so the
    // real hydrate() -> toLoadedState() -> normalizeDraft() path is exercised
    bridgeStub.loadStores = async () => ({
      collections: [{ id: 'col-1', name: 'My API', items: [] }],
      environments: { environments: [], globals: [] },
      history: [],
      settings: {},
      tabs: { tabs: [{ id: 'tab-1', name: 'Example', draft: { method: 'GET', url: 'https://example.com' } }] },
    })
    const { actions } = await import('../src/state/actions')
    actions.hydrate()
    const App = (await import('../src/App')).default
    const { unmount } = render(<App />)
    // the request URL lands in the editor because tab-1 became active
    expect(await screen.findByDisplayValue('https://example.com')).toBeTruthy()
    // persisted collection shows up in the sidebar without crashing
    expect(await screen.findByText('My API')).toBeTruthy()
    unmount()
  })
})

describe('state store', () => {
  it('newTab adds a tab; closeTab removes and reactivates neighbor', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    const before = appStore.get()
    actions.newTab({ url: 'https://one.io' })
    actions.newTab({ url: 'https://two.io' })
    const with2 = appStore.get()
    expect(with2.tabs.length).toBe(before.tabs.length + 2)
    expect(with2.activeTabId).toBe(with2.tabs[with2.tabs.length - 1].id)

    const removedId = with2.activeTabId as string
    actions.closeTab(removedId)
    const after = appStore.get()
    expect(after.tabs.map((t) => t.id)).not.toContain(removedId)
    expect(after.activeTabId).not.toBe(removedId)
  })

  it('updateTab mutates draft and marks dirty', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    actions.newTab({ url: 'https://dirty.io' })
    const t = appStore.get().tabs[appStore.get().tabs.length - 1]
    actions.updateTab(t.id, (d) => { d.headers.push({ id: 'h1', key: 'X-Test', value: '1', enabled: true }) })
    const updated = appStore.get().tabs.find((x) => x.id === t.id)!
    expect(updated.draft.headers).toHaveLength(1)
    expect(updated.dirty).toBe(true)
  })

  it('saveAll writes each store slice through the bridge', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    appStore.set({ collections: [{ id: 'col-x', name: 'X', items: [] }] })
    await actions.saveAll()
    expect(saveStore).toHaveBeenCalled()
    const names = saveStore.mock.calls.map((c) => c[0])
    expect(names).toEqual(expect.arrayContaining(['collections', 'environments', 'history', 'settings', 'tabs']))
  })

  it('query param edits rewrite the URL', async () => {
    const { actions, appStore } = await import('../src/state/actions')
    actions.newTab({ url: 'https://p.io/path' })
    const t = appStore.get().tabs[appStore.get().tabs.length - 1]
    // simulate what ParamsPanel does via splitUrl/buildUrl
    const { splitUrl, buildUrl } = await import('../shared/http-utils')
    const { base, pairs } = splitUrl(t.draft.url)
    actions.updateTab(t.id, (d) => { d.url = buildUrl(base, [...(pairs ?? []), { id: 'n1', key: 'page', value: '1', description: '', enabled: true }]) })
    const updated = appStore.get().tabs.find((x) => x.id === t.id)!
    expect(updated.draft.url).toBe('https://p.io/path?page=1')
    const parsed = splitUrl(updated.draft.url)
    expect(parsed.pairs?.some((p) => p.key === 'page')).toBe(true)
  })
})
