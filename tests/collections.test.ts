import { describe, expect, it } from 'vitest'
import { actions, appStore } from '../src/state/actions'
import type { Collection, CollectionItem, RequestDraft, SavedRequest } from '../shared/models'
import { DEFAULT_REQUEST } from '../shared/models'

const req = (id: string, name: string, url = 'https://x.dev/api'): CollectionItem => ({
  id,
  kind: 'request',
  name,
  request: { ...DEFAULT_REQUEST, id, name, url } as SavedRequest,
})

const fol = (id: string, name: string, items: CollectionItem[] = []): CollectionItem => ({ id, kind: 'folder', name, items })

function seed(): Collection {
  const col: Collection = {
    id: 'c1',
    name: 'API',
    items: [req('r1', 'Alpha'), fol('f1', 'Users', [req('r2', 'Login'), fol('f2', 'Admin', [req('r3', 'Boot')])])],
  }
  appStore.set({ collections: [col], tabs: [], activeTabId: null })
  return col
}

describe('collection tree actions', () => {
  it('renameCollectionItem renames the item, its saved draft, and the open tab', () => {
    seed()
    appStore.set({
      tabs: [
        {
          id: 't1',
          name: 'Alpha',
          requestId: 'r1',
          collectionId: 'c1',
          folderPath: [],
          dirty: false,
          draft: { ...DEFAULT_REQUEST, name: 'Alpha' } as RequestDraft,
        },
      ],
      activeTabId: 't1',
    })
    actions.renameCollectionItem('c1', 'r1', '  Beta  ')
    const col = appStore.get().collections[0]
    expect(col.items[0].name).toBe('Beta')
    expect((col.items[0].kind === 'request' && col.items[0].request.name) as string).toBe('Beta')
    const t = appStore.get().tabs[0]
    expect(t.name).toBe('Beta')
    expect(t.draft.name).toBe('Beta')
    // blank names are ignored
    actions.renameCollectionItem('c1', 'r1', '   ')
    expect(appStore.get().collections[0].items[0].name).toBe('Beta')
  })

  it('moveCollectionItem moves a request from a folder to the collection root and syncs folderPath', () => {
    seed()
    appStore.set({
      tabs: [{ id: 't2', name: 'Login', requestId: 'r2', collectionId: 'c1', folderPath: ['f1'], dirty: false, draft: { ...DEFAULT_REQUEST, name: 'Login' } as RequestDraft }],
      activeTabId: 't2',
    })
    actions.moveCollectionItem('c1', 'r2', 'c1', null, null)
    const col = appStore.get().collections[0]
    expect(col.items.map((i) => i.id)).toEqual(['r1', 'f1', 'r2'])
    expect(appStore.get().tabs[0].folderPath).toEqual([])
  })

  it('moveCollectionItem refuses to drop a folder into its own subtree', () => {
    seed()
    actions.moveCollectionItem('c1', 'f1', 'c1', 'f2', null)
    const col = appStore.get().collections[0]
    // unchanged: f1 still at root, f2 still nested
    expect(col.items.map((i) => i.id)).toEqual(['r1', 'f1'])
    expect(col.items[1].kind === 'folder' && col.items[1].items[1].id).toBe('f2')
  })

  it('moveCollectionItem reorders requests by index (drop before target)', () => {
    seed()
    actions.moveCollectionItem('c1', 'r1', 'c1', null, 0) // no-op reorder to itself slot
    expect(appStore.get().collections[0].items[0].id).toBe('r1')
    actions.moveCollectionItem('c1', 'f1', 'c1', null, 0)
    const ids = appStore.get().collections[0].items.map((i) => i.id)
    expect(ids).toEqual(['f1', 'r1'])
  })

  it('duplicateCollectionItem deep-copies with new ids and (copy) names', () => {
    seed()
    actions.duplicateCollectionItem('c1', 'f1')
    const col = appStore.get().collections[0]
    expect(col.items.length).toBe(3)
    const copyItem = col.items[2]
    expect(copyItem.name).toBe('Users (copy)')
    expect(copyItem.id).not.toBe('f1')
    if (copyItem.kind === 'folder') {
      const inner = copyItem.items[0]
      expect(inner.name).toBe('Login (copy)')
      expect(inner.id).not.toBe('r2')
      if (inner.kind === 'request') expect(inner.request.id).toBe(inner.id)
    } else {
      expect.fail('expected folder copy')
    }
  })

  it('deleteCollectionItem removes the subtree and closes tabs inside it', () => {
    seed()
    appStore.set({
      tabs: [
        { id: 't3', name: 'Boot', requestId: 'r3', collectionId: 'c1', folderPath: ['f1', 'f2'], dirty: false, draft: { ...DEFAULT_REQUEST, name: 'Boot' } as RequestDraft },
        { id: 't4', name: 'Alpha', requestId: 'r1', collectionId: 'c1', folderPath: [], dirty: false, draft: { ...DEFAULT_REQUEST, name: 'Alpha' } as RequestDraft },
      ],
      activeTabId: 't3',
    })
    actions.deleteCollectionItem('c1', 'f2')
    const col = appStore.get().collections[0]
    const f1 = col.items[1]
    expect(f1.kind === 'folder' && f1.items.length).toBe(1)
    const kept = appStore.get().tabs
    expect(kept.map((t) => t.id)).toEqual(['t4'])
    expect(appStore.get().activeTabId).toBe('t4')
  })
})
