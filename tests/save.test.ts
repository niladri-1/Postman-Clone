import { describe, expect, it } from 'vitest'
import { actions, appStore } from '../src/state/actions'
import type { Collection, OpenTab, RequestDraft, SavedRequest } from '../shared/models'
import { DEFAULT_REQUEST } from '../shared/models'

const draft = (name: string, url: string): RequestDraft => ({ ...DEFAULT_REQUEST, name, url })

function tabWith(over: Partial<OpenTab>): OpenTab {
  return {
    id: 't1',
    name: 'Old',
    requestId: undefined,
    collectionId: undefined,
    folderPath: [],
    dirty: true,
    draft: draft('Old', 'https://api.dev/ping'),
    ...over,
  }
}

describe('saveActiveRequest (one-click save, no dialog)', () => {
  it('creates “My Collection” and saves a fresh tab at its root', () => {
    appStore.set({ collections: [], tabs: [tabWith({})], activeTabId: 't1' })
    actions.saveActiveRequest('t1')
    const s = appStore.get()
    expect(s.collections.length).toBe(1)
    expect(s.collections[0].name).toBe('My Collection')
    const item = s.collections[0].items[0]
    expect(item.kind === 'request' && item.name).toBe('Old')
    const t = s.tabs[0]
    expect(t.collectionId).toBe(s.collections[0].id)
    expect(t.requestId).toBeTruthy()
    expect(t.dirty).toBe(false)
  })

  it('saves into the first existing collection when present', () => {
    const col: Collection = { id: 'c1', name: 'API', items: [] }
    appStore.set({ collections: [col], tabs: [tabWith({ draft: draft('Ping', 'https://api.dev/ping') })], activeTabId: 't1' })
    actions.saveActiveRequest('t1')
    const colNow = appStore.get().collections[0]
    expect(colNow.id).toBe('c1')
    expect(appStore.get().tabs[0].collectionId).toBe('c1')
    expect(colNow.items[0].kind === 'request' && colNow.items[0].name).toBe('Ping')
  })

  it('updates in place — same folder, same id, new name; no duplicate', () => {
    const col: Collection = {
      id: 'c1',
      name: 'API',
      items: [
        { id: 'fol1', kind: 'folder', name: 'F', items: [] },
        { id: 'r9', kind: 'request', name: 'Old', request: { ...DEFAULT_REQUEST, id: 'r9', name: 'Old', url: 'https://api.dev/ping' } as SavedRequest },
      ],
    }
    appStore.set({
      collections: [col],
      tabs: [tabWith({ requestId: 'r9', collectionId: 'c1', draft: draft('Renamed', 'https://api.dev/ping2') })],
      activeTabId: 't1',
    })
    actions.saveActiveRequest('t1')
    const colNow = appStore.get().collections[0]
    expect(colNow.items.length).toBe(2) // no duplicate row
    const item = colNow.items[1]
    expect(item.kind === 'request' && item.name).toBe('Renamed')
    expect(appStore.get().tabs[0].name).toBe('Renamed')
    expect(appStore.get().tabs[0].dirty).toBe(false)
  })
})
