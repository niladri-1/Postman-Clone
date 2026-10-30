import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import type { Collection, CollectionItem, RequestDraft } from '../../shared/models'

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

interface FlatFolder {
  colId: string
  folderId: string | null
  label: string
}

export default function SaveRequestModal({ tabId, onClose }: { tabId: string; onClose: () => void }): JSX.Element {
  const collections = useStore(appStore, (s) => s.collections)
  const tabs = useStore(appStore, (s) => s.tabs)
  const tab = tabs.find((t) => t.id === tabId)
  const [name, setName] = useState((tab?.draft.name ?? '').trim() || tab?.name || 'Untitled Request')
  const [colId, setColId] = useState(tab?.collectionId ?? collections[0]?.id ?? '')
  const [folderId, setFolderId] = useState<string | ''>(tab?.folderPath?.[tab.folderPath.length - 1] ?? '')

  const folders = useMemo(() => flattenFolders(collections), [collections])
  const foldersForCol = folders.filter((f) => f.colId === colId)
  const col = collections.find((c) => c.id === colId)

  const save = (): void => {
    if (!tab || !col) return
    const draft: RequestDraft = JSON.parse(JSON.stringify(tab.draft)) as RequestDraft
    const targetFolder: string | null = folderId === '' ? null : folderId

    if (tab.requestId && tab.collectionId === colId) {
      // update in place: pop, mutate, reinsert (honors a folder change)
      const popped = popRequest(col.items, tab.requestId)
      if (!popped) return
      const updated: CollectionItem =
        popped.item.kind === 'request'
          ? { ...popped.item, name, request: { ...draft, id: popped.item.id, name } }
          : popped.item
      const next = insertRequest(popped.items, updated, targetFolder)
      actions.patchCollectionItems(col.id, next)
      actions.markSaved(tabId, tab.requestId, name, colId, folderPathById(next, tab.requestId) ?? [])
      actions.toast('Request updated', 'success')
    } else {
      const newId = 'req-' + uid()
      const item: CollectionItem = { id: newId, kind: 'request', name, request: { ...draft, id: newId, name } }
      const next = insertRequest(col.items, item, targetFolder)
      actions.patchCollectionItems(col.id, next)
      actions.markSaved(tabId, newId, name, colId, folderPathById(next, newId) ?? [])
      actions.toast(`Saved to “${col.name}”`, 'success')
    }
    onClose()
  }

  if (collections.length === 0) {
    return (
      <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ width: 380 }}>
          <div className="modal-head">Save request</div>
          <div className="modal-body">
            <p style={{ color: 'var(--text-2)', fontSize: 12.5 }}>Create a collection first (sidebar → +).</p>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">{tab?.requestId ? 'Save as… (updates a copy in the chosen location)' : 'Save request'}</div>
        <div className="modal-body">
          <div className="form-field">
            <label>Request name</label>
            <input className="text-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label>Collection</label>
              <select
                className="select-input"
                style={{ width: '100%' }}
                value={colId}
                onChange={(e) => { setColId(e.target.value); setFolderId('') }}
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Folder</label>
              <select className="select-input" style={{ width: '100%' }} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">(collection root)</option>
                {foldersForCol.map((f) => (
                  <option key={f.folderId ?? ''} value={f.folderId ?? ''}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || !colId} onClick={save}>
            {tab?.requestId && tab.collectionId === colId ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

type CollItems = CollectionItem[]

function flattenFolders(collections: Collection[]): FlatFolder[] {
  const out: FlatFolder[] = []
  const walk = (colId: string, items: CollItems, prefix: string): void => {
    for (const it of items) {
      if (it.kind === 'folder') {
        const label = prefix ? `${prefix} / ${it.name}` : it.name
        out.push({ colId, folderId: it.id, label })
        walk(colId, it.items, label)
      }
    }
  }
  for (const c of collections) walk(c.id, c.items, '')
  return out
}

/** Remove a request item from the tree, returning the new items and the popped one. */
function popRequest(items: CollItems, requestId: string): { items: CollItems; item: CollectionItem } | undefined {
  let popped: CollectionItem | undefined
  const walk = (list: CollItems): CollItems =>
    list.flatMap((it): CollItems => {
      if (it.kind === 'request' && it.id === requestId) {
        popped = it
        return []
      }
      return it.kind === 'folder' ? [{ ...it, items: walk(it.items) }] : [it]
    })
  const next = walk(items)
  return popped ? { items: next, item: popped } : undefined
}

function insertRequest(items: CollItems, item: CollectionItem, folderId: string | null): CollItems {
  if (folderId === null) return [...items, item]
  return items.map((it) =>
    it.kind === 'folder' ? (it.id === folderId ? { ...it, items: [...it.items, item] } : { ...it, items: insertRequest(it.items, item, folderId) }) : it,
  )
}

/** Folder ids above requestId (for the tab breadcrumb). */
function folderPathById(items: CollItems, requestId: string, path: string[] = []): string[] | undefined {
  for (const it of items) {
    if (it.kind === 'request' && it.id === requestId) return path
    if (it.kind === 'folder') {
      const found = folderPathById(it.items, requestId, [...path, it.id])
      if (found !== undefined) return found
    }
  }
  return undefined
}

