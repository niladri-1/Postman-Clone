import type { JSX } from 'react'
import { useMemo, useState, type ReactNode } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { ClockIcon, CollectionIcon, ConsoleIcon, CookieIcon, FolderIcon, LayersIcon, MoreIcon, PlusIcon } from '../ui/icons'
import { MethodPill, PromptDialog, useDismissed } from '../ui/controls'
import EnvEditorModal from './EnvEditorModal'
import { DEFAULT_REQUEST } from '../../shared/models'
import type { Collection, CollectionItem, Environment, RequestDraft } from '../../shared/models'

// --- drag & drop --------------------------------------------------------------

export interface DragPayload {
  colId: string
  id: string
  kind: 'folder' | 'request'
}

const DND_MIME = 'text/x-pm-node'

/** Chromium hides dataTransfer.getData during dragover, so the dragged node
 *  travels through this module-level variable until the drop completes. */
let activeDrag: DragPayload | null = null

function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData('text/plain')
    if (!raw) return null
    const p = JSON.parse(raw) as DragPayload
    if (typeof p.colId === 'string' && typeof p.id === 'string' && (p.kind === 'folder' || p.kind === 'request')) return p
    return null
  } catch {
    return null
  }
}

// --- tree helpers -----------------------------------------------------------

function updateItem(items: CollectionItem[], id: string, fn: (it: CollectionItem) => CollectionItem): CollectionItem[] {
  return items.map((it) =>
    it.id === id ? fn(it) : it.kind === 'folder' ? { ...it, items: updateItem(it.items, id, fn) } : it,
  )
}

function findRequest(items: CollectionItem[], id: string, path: string[] = []):
  | { draft: RequestDraft; folderIds: string[] }
  | undefined {
  for (const it of items) {
    if (it.kind === 'request' && it.id === id) return { draft: it.request, folderIds: path }
    if (it.kind === 'folder') {
      const found = findRequest(it.items, id, [...path, it.id])
      if (found) return found
    }
  }
  return undefined
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// --- sidebar shell ----------------------------------------------------------

export default function Sidebar(): JSX.Element {
  const width = useStore(appStore, (s) => s.sidebarWidth)
  const panel = useStore(appStore, (s) => s.panel)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  return (
    <div className="sidebar" style={{ width }}>
      <nav className="sidebar-rail">
        <RailButton active={panel === 'collections'} title="Collections" onClick={() => actions.setPanel('collections')} icon={<CollectionIcon />} />
        <RailButton active={panel === 'environments'} title="Environments" onClick={() => actions.setPanel('environments')} icon={<LayersIcon />} />
        <RailButton active={panel === 'history'} title="History" onClick={() => actions.setPanel('history')} icon={<ClockIcon />} />
        <div className="rail-spacer" />
        <RailButton title="Cookies" onClick={() => actions.openModal('cookies')} icon={<CookieIcon />} />
        <RailButton title="Import collection or environment" onClick={() => actions.openModal('import')} icon={<PlusIcon />} />
      </nav>

      <div className="sidebar-main">
        <div className="sidebar-head">
          <input className="sidebar-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button
            className="side-icon-btn"
            title="New"
            onClick={() => actions.openModal(panel === 'environments' ? 'newEnv' : panel === 'collections' ? 'newCollection' : 'newEnv')}
          >
            <PlusIcon />
          </button>
        </div>

        <div className="sidebar-body">
          {panel === 'collections' ? <CollectionsPanel query={q} /> : null}
          {panel === 'environments' ? <EnvironmentsPanel query={q} /> : null}
          {panel === 'history' ? <HistoryPanel query={q} /> : null}
        </div>

        <div className="sidebar-footer">
          <span className="footer-link" onClick={actions.toggleConsole} title="Console">
            <ConsoleIcon /> Console
          </span>
          <span className="footer-link" onClick={() => actions.openModal('cookies')} title="Cookie jar">
            <CookieIcon /> Cookies
          </span>
        </div>
      </div>

      <div
        className="sidebar-resizer"
        onMouseDown={(e) => {
          e.preventDefault()
          const startX = e.clientX
          const startW = appStore.get().sidebarWidth || 250
          const onMove = (ev: MouseEvent): void => actions.setSidebarWidth(startW + (ev.clientX - startX))
          const onUp = (): void => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
      />
    </div>
  )
}

function RailButton(props: { active?: boolean; title: string; onClick: () => void; icon: ReactNode }): JSX.Element {
  return (
    <button className={`rail-btn${props.active ? ' active' : ''}`} title={props.title} onClick={props.onClick}>
      {props.icon}
    </button>
  )
}

// --- menus --------------------------------------------------------------------

interface MenuItem {
  label: string
  danger?: boolean
  onPick: () => void
}

/** Inline dropdown attached to a ⋯ button. Parent must be position:relative. */
function RowMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }): JSX.Element {
  const { ref } = useDismissed(true, onClose)
  return (
    <div className="dropdown" ref={ref} style={{ top: 16, right: 0, left: 'auto' }}>
      {items.map((mi) => (
        <button
          key={mi.label}
          className={`dropdown-item`}
          style={{ color: mi.danger ? 'var(--red)' : undefined, ...(!mi.danger ? {} : {}) }}
          onClick={() => {
            onClose()
            mi.onPick()
          }}
        >
          {mi.label}
        </button>
      ))}
    </div>
  )
}

/** Right-click context menu; fixed position, clamped to the viewport. */
function TreeContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }): JSX.Element | null {
  const { ref } = useDismissed(true, onClose)
  const width = 190
  const left = Math.max(6, Math.min(x, window.innerWidth - width - 8))
  const top = Math.max(6, Math.min(y, window.innerHeight - items.length * 30 - 12))
  return (
    <div className="dropdown context" ref={ref} style={{ position: 'fixed', top, left, width, maxHeight: 320, overflowY: 'auto' }}>
      {items.map((mi) => (
        <button
          key={mi.label}
          className="dropdown-item"
          style={{ color: mi.danger ? 'var(--red)' : undefined }}
          onMouseDown={(ev) => {
            ev.preventDefault()
            onClose()
            mi.onPick()
          }}
        >
          {mi.label}
        </button>
      ))}
    </div>
  )
}

// --- collections --------------------------------------------------------------

function CollectionsPanel({ query }: { query: string }): JSX.Element {
  const cols = useStore(appStore, (s) => s.collections)

  const filtered = useMemo(
    () =>
      query
        ? cols
            .map((c) => ({ ...c, items: c.items.filter((it) => it.name.toLowerCase().includes(query)) }))
            .filter((c) => c.name.toLowerCase().includes(query) || c.items.length > 0)
        : cols,
    [cols, query],
  )

  return (
    <div>
      <div className="side-section">Collections <span className="count">{cols.length}</span></div>
      {cols.length === 0 ? (
        <div className="empty-hint">
          No collections yet.
          <br />
          Create one with the <strong>+</strong> button above.
        </div>
      ) : null}
      {filtered.map((c) => (
        <CollectionBlock key={c.id} col={c as Collection} query={query} />
      ))}
    </div>
  )
}

function CollectionBlock({ col, query }: { col: Collection; query: string }): JSX.Element {
  const [open, setOpen] = useState(true)
  const [menu, setMenu] = useState(false)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [prompt, setPrompt] = useState<'rename' | 'folder' | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const items: MenuItem[] = [
    { label: 'Add folder', onPick: () => setPrompt('folder') },
    {
      label: 'Add request',
      onPick: () => {
        const newId = 'req-' + uid()
        const item: CollectionItem = {
          id: newId,
          kind: 'request',
          name: 'New Request',
          request: { ...DEFAULT_REQUEST, id: newId, name: 'New Request' },
        }
        actions.patchCollectionItems(col.id, [...col.items, item])
        openRequest(col.id, item.id)
      },
    },
    { label: 'Rename', onPick: () => setPrompt('rename') },
    { label: 'Delete collection', danger: true, onPick: () => actions.deleteCollection(col.id) },
  ]

  return (
    <div>
      <div
        className={`tree-row col-root${dragOver ? ' drop-into' : ''}`}
        onClick={() => setOpen((v) => !v)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setCtx({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          if (!activeDrag) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const p = activeDrag ?? readDragPayload(e)
          activeDrag = null
          if (p) actions.moveCollectionItem(p.colId, p.id, col.id, null, null)
        }}
      >
        <span className={`chev${open ? ' open' : ''}`}>▶</span>
        <FolderIcon />
        <span className="row-label" style={{ fontWeight: 600, color: 'var(--text)' }}>{col.name}</span>
        <span
          className="side-icon-btn"
          style={{ position: 'relative', marginLeft: 'auto' }}
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
        >
          <MoreIcon />
          {menu ? <RowMenu onClose={() => setMenu(false)} items={items} /> : null}
        </span>
      </div>
      {open
        ? col.items.map((it) => (
            <Node key={it.id} colId={col.id} item={it} depth={1} query={query} />
          ))
        : null}
      {ctx ? <TreeContextMenu x={ctx.x} y={ctx.y} items={items} onClose={() => setCtx(null)} /> : null}
      {prompt ? (
        <PromptDialog
          title={prompt === 'rename' ? 'Rename collection' : 'New folder'}
          initial={prompt === 'rename' ? col.name : 'New Folder'}
          onConfirm={(v) => {
            setPrompt(null)
            if (prompt === 'rename') actions.renameCollection(col.id, v)
            else
              actions.patchCollectionItems(col.id, [
                ...col.items,
                { id: 'fol-' + uid(), kind: 'folder', name: v, items: [] },
              ])
          }}
          onClose={() => setPrompt(null)}
        />
      ) : null}
    </div>
  )
}

interface NodeProps {
  colId: string
  item: CollectionItem
  depth: number
  query: string
}

function Node({ colId, item, depth, query }: NodeProps): JSX.Element {
  if (item.kind === 'folder') return <FolderNode colId={colId} item={item} depth={depth} query={query} />
  return <RequestNode colId={colId} item={item} depth={depth} />
}

interface RequestNodeProps {
  colId: string
  item: Extract<CollectionItem, { kind: 'request' }>
  depth: number
}

function FolderNode({ colId, item, depth, query }: NodeProps & { item: Extract<CollectionItem, { kind: 'folder' }> }): JSX.Element {
  const [open, setOpen] = useState(true)
  const [menu, setMenu] = useState(false)
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [renamePrompt, setRenamePrompt] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const matches = item.name.toLowerCase().includes(query) || item.items.length > 0
  if (query && !matches) return <></>

  const items: MenuItem[] = [
    {
      label: 'Add request',
      onPick: () => {
        const newId = 'req-' + uid()
        const child: CollectionItem = {
          id: newId,
          kind: 'request',
          name: 'New Request',
          request: { ...DEFAULT_REQUEST, id: newId, name: 'New Request' },
        }
        const next = updateItem(appStore.get().collections.find((c) => c.id === colId)?.items ?? [], item.id, (f) =>
          f.kind === 'folder' ? { ...f, items: [...f.items, child] } : f,
        )
        actions.patchCollectionItems(colId, next)
        openRequest(colId, child.id)
      },
    },
    {
      label: 'Add folder',
      onPick: () => {
        const next = updateItem(appStore.get().collections.find((c) => c.id === colId)?.items ?? [], item.id, (f) =>
          f.kind === 'folder' ? { ...f, items: [...f.items, { id: 'fol-' + uid(), kind: 'folder', name: 'New Folder', items: [] }] } : f,
        )
        actions.patchCollectionItems(colId, next)
      },
    },
    { label: 'Rename', onPick: () => setRenamePrompt(true) },
    { label: 'Duplicate', onPick: () => actions.duplicateCollectionItem(colId, item.id) },
    { label: 'Delete folder', danger: true, onPick: () => actions.deleteCollectionItem(colId, item.id) },
  ]

  return (
    <div>
      <div
        className={`tree-row${dragOver ? ' drop-into' : ''}`}
        onClick={() => setOpen((v) => !v)}
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          activeDrag = { colId, id: item.id, kind: 'folder' }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(DND_MIME, JSON.stringify({ colId, id: item.id, kind: 'folder' }))
          e.dataTransfer.setData('text/plain', JSON.stringify({ colId, id: item.id, kind: 'folder' }))
        }}
        onDragEnd={() => { activeDrag = null; setDragOver(false) }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setCtx({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          if (!activeDrag || activeDrag.id === item.id) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const p = activeDrag ?? readDragPayload(e)
          activeDrag = null
          if (!p || p.id === item.id) return
          if (p.colId === colId && isAncestorOf(appStore.get().collections.find((c) => c.id === colId)?.items ?? [], p.id, item.id)) {
            return // cannot drop a folder into its own subtree
          }
          actions.moveCollectionItem(p.colId, p.id, colId, item.id, null)
        }}
      >
        <span className="tree-indent" style={{ width: depth * 10 }} />
        <span className={`chev${open ? ' open' : ''}`}>▶</span>
        <span className="row-label">{item.name}</span>
        <span
          className="side-icon-btn"
          style={{ position: 'relative', marginLeft: 'auto' }}
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
        >
          <MoreIcon />
          {menu ? <RowMenu onClose={() => setMenu(false)} items={items} /> : null}
        </span>
      </div>
      {open ? item.items.map((it) => <Node key={it.id} colId={colId} item={it} depth={depth + 1} query={query} />) : null}
      {ctx ? <TreeContextMenu x={ctx.x} y={ctx.y} items={items} onClose={() => setCtx(null)} /> : null}
      {renamePrompt ? (
        <PromptDialog
          title="Rename folder"
          initial={item.name}
          confirmLabel="Rename"
          onConfirm={(v) => {
            setRenamePrompt(false)
            actions.renameCollectionItem(colId, item.id, v)
          }}
          onClose={() => setRenamePrompt(false)}
        />
      ) : null}
    </div>
  )
}

/** True when draggedId is the target folder itself or one of its ancestors. */
function isAncestorOf(colItems: CollectionItem[], draggedId: string, targetId: string): boolean {
  const walk = (items: CollectionItem[], parents: string[]): boolean => {
    for (const it of items) {
      if (it.id === targetId) return parents.includes(draggedId)
      if (it.kind === 'folder' && walk(it.items, [...parents, it.id])) return true
    }
    return false
  }
  return walk(colItems, [])
}

function RequestNode({ colId, item, depth }: RequestNodeProps): JSX.Element {
  const active = useStore(appStore, (s) => (s.activeTabId ? s.tabs.find((t) => t.id === s.activeTabId)?.requestId : undefined))
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)
  const [renamePrompt, setRenamePrompt] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const items: MenuItem[] = [
    { label: 'Open', onPick: () => openRequest(colId, item.id) },
    { label: 'Rename', onPick: () => setRenamePrompt(true) },
    { label: 'Duplicate', onPick: () => actions.duplicateCollectionItem(colId, item.id) },
    {
      label: 'Copy URL',
      onPick: () => {
        void navigator.clipboard.writeText(item.request.url || '')
        actions.toast(item.request.url ? 'URL copied' : 'Request has no URL yet', 'info')
      },
    },
    { label: 'Delete request', danger: true, onPick: () => actions.deleteCollectionItem(colId, item.id) },
  ]

  return (
    <div>
      <div
        className={`tree-row req-row${active === item.id ? ' active' : ''}${dragOver ? ' drop-before' : ''}`}
        onClick={() => openRequest(colId, item.id)}
        onDoubleClick={() => setRenamePrompt(true)}
        title={item.request.url}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openRequest(colId, item.id)
          }
        }}
        draggable
        onDragStart={(e) => {
          activeDrag = { colId, id: item.id, kind: 'request' }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(DND_MIME, JSON.stringify({ colId, id: item.id, kind: 'request' }))
          e.dataTransfer.setData('text/plain', JSON.stringify({ colId, id: item.id, kind: 'request' }))
        }}
        onDragEnd={() => { activeDrag = null; setDragOver(false) }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setCtx({ x: e.clientX, y: e.clientY })
        }}
        onDragOver={(e) => {
          if (!activeDrag || activeDrag.id === item.id) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const p = activeDrag ?? readDragPayload(e)
          activeDrag = null
          if (!p || p.id === item.id) return
          // insert before this request, within its parent list
          const col = appStore.get().collections.find((c) => c.id === colId)
          if (!col) return
          const loc = locateTarget(col.items, item.id)
          actions.moveCollectionItem(p.colId, p.id, colId, loc?.parentId ?? null, loc?.index ?? null)
        }}
      >
        <span className="tree-indent" style={{ width: depth * 10 }} />
        <span className="chev" />
        <MethodPill method={item.request.method} />
        <span className="row-label">{item.name}</span>
      </div>
      {ctx ? <TreeContextMenu x={ctx.x} y={ctx.y} items={items} onClose={() => setCtx(null)} /> : null}
      {renamePrompt ? (
        <PromptDialog
          title="Rename request"
          initial={item.name}
          confirmLabel="Rename"
          onConfirm={(v) => {
            setRenamePrompt(false)
            actions.renameCollectionItem(colId, item.id, v)
          }}
          onClose={() => setRenamePrompt(false)}
        />
      ) : null}
    </div>
  )
}

/** Locate a node in collection items: parent folder id (null = root) + index. */
function locateTarget(items: CollectionItem[], id: string, parents: string[] = []): { parentId: string | null; index: number } | undefined {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.id === id) return { parentId: parents[parents.length - 1] ?? null, index: i }
    if (it.kind === 'folder') {
      const found = locateTarget(it.items, id, [...parents, it.id])
      if (found) return found
    }
  }
  return undefined
}

function openRequest(collectionId: string, requestId: string): void {
  const col = appStore.get().collections.find((c) => c.id === collectionId)
  if (!col) return
  const found = findRequest(col.items, requestId)
  if (!found) return
  const existing = appStore.get().tabs.find((t) => t.requestId === requestId)
  if (existing) {
    actions.activateTab(existing.id)
    return
  }
  const id = 'tab-' + uid()
  actions.openTab({
    id,
    name: found.draft.name || col.name,
    requestId,
    collectionId,
    folderPath: found.folderIds,
    draft: JSON.parse(JSON.stringify(found.draft)) as RequestDraft,
    dirty: false,
  })
}

// --- environments --------------------------------------------------------------

function EnvironmentsPanel({ query }: { query: string }): JSX.Element {
  const envs = useStore(appStore, (s) => s.environments)
  const activeId = useStore(appStore, (s) => s.activeEnvId)
  const globals = useStore(appStore, (s) => s.globals)
  const [renaming, setRenaming] = useState<Environment | null>(null)
  const [editing, setEditing] = useState<Environment | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  return (
    <div>
      <div className="side-section">Environments <span className="count">{envs.length}</span></div>
      {envs.length === 0 ? <div className="empty-hint">No environments yet.<br />Create one with the <strong>+</strong> button above.</div> : null}
      {envs
        .filter((e) => !query || e.name.toLowerCase().includes(query))
        .map((e) => (
          <div className="tree-row" key={e.id} onClick={() => setEditing(e)} title="Click to edit variables">
            <LayersIcon />
            <span className="row-label">{e.name}</span>
            <span
              className="side-icon-btn"
              style={{ position: 'relative', marginLeft: 'auto' }}
              onClick={(ev) => {
                ev.stopPropagation()
                setMenuFor(menuFor === e.id ? null : e.id)
              }}
            >
              <MoreIcon />
              {menuFor === e.id ? (
                <RowMenu
                  onClose={() => setMenuFor(null)}
                  items={[
                    { label: 'Set active', onPick: () => actions.setActiveEnv(e.id === activeId ? null : e.id) },
                    { label: 'Rename', onPick: () => setRenaming(e) },
                    { label: 'Delete', danger: true, onPick: () => actions.deleteEnvironment(e.id) },
                  ]}
                />
              ) : null}
            </span>
          </div>
        ))}
      <div className="side-section">Globals <span className="count">{globals.length}</span></div>
      <div className="kv-empty" style={{ padding: '6px 8px' }}>Available everywhere; edit via the status bar.</div>

      {renaming ? (
        <PromptDialog
          title="Rename environment"
          initial={renaming.name}
          confirmLabel="Rename"
          onConfirm={(v) => {
            actions.renameEnvironment(renaming.id, v)
            setRenaming(null)
          }}
          onClose={() => setRenaming(null)}
        />
      ) : null}
      {editing ? <EnvEditorModal envId={editing.id} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

// --- history -----------------------------------------------------------------

function HistoryPanel({ query }: { query: string }): JSX.Element {
  const hist = useStore(appStore, (s) => s.history)
  const filtered = hist.filter(
    (h) => !query || h.url.toLowerCase().includes(query) || h.name.toLowerCase().includes(query),
  )

  return (
    <div>
      <div className="side-section">History <span className="count">{hist.length}</span></div>
      {filtered.length === 0 ? <div className="empty-hint">No history yet — send a request.</div> : null}
      {filtered.slice(0, 200).map((h) => (
        <button className="tree-row" key={h.id} onClick={() => actions.newTab({ method: h.method, url: h.url })} title={h.url}>
          <MethodPill method={h.method} />
          <span className="row-label">{h.name || h.url}</span>
        </button>
      ))}
      {hist.length > 0 ? (
        <button className="tree-row" onClick={() => actions.clearHistory()}>
          <span className="row-label" style={{ color: 'var(--red)' }}>Clear history</span>
        </button>
      ) : null}
    </div>
  )
}

