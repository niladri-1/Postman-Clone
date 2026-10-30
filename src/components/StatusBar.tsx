import type { JSX } from 'react'
import { useState } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { ConsoleIcon, CookieIcon, GlobeIcon } from '../ui/icons'
import EnvEditor from './EnvEditorModal'

export default function StatusBar(): JSX.Element {
  const pendingCount = useStore(appStore, (s) => Object.keys(s.pending).length)
  const tabs = useStore(appStore, (s) => s.tabs)
  const active = useStore(appStore, (s) => s.activeTabId)
  const [editingGlobals, setEditingGlobals] = useState(false)

  const activeTab = tabs.find((t) => t.id === active)
  let host = ''
  if (activeTab) {
    try {
      host = new URL(activeTab.draft.url).hostname
    } catch {
      host = ''
    }
  }

  return (
    <div className="statusbar">
      <span className="sb-item">
        {pendingCount > 0 ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} running…` : host ? `${activeTab?.draft.method} ${host}` : 'Ready'}
      </span>
      <div className="sb-right">
        <span className="sb-item" onClick={() => setEditingGlobals(true)} title="Edit global variables">
          <GlobeIcon /> Globals
        </span>
        <span className="sb-item" onClick={() => actions.openModal('cookies')} title="Cookie jar">
          <CookieIcon /> Cookies
        </span>
        <ConsoleToggle />
      </div>
      {editingGlobals ? <EnvEditor envId="globals" onClose={() => setEditingGlobals(false)} /> : null}
    </div>
  )
}

function ConsoleToggle(): JSX.Element {
  const open = useStore(appStore, (s) => s.consoleOpen)
  const logCount = useStore(appStore, (s) => (s.activeTabId ? (s.scriptLogs[s.activeTabId]?.length ?? 0) : 0))
  return (
    <span className="sb-item" onClick={actions.toggleConsole} title="Script console">
      <ConsoleIcon /> Console {open ? '' : logCount > 0 ? <span className="sb-badge">{logCount}</span> : null}
    </span>
  )
}

