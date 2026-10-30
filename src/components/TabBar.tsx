import type { JSX } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { MethodMini } from '../ui/controls'
import { PlusIcon } from '../ui/icons'
import type { OpenTab } from '../../shared/models'

export default function TabBar(): JSX.Element {
  const tabs = useStore(appStore, (st) => st.tabs)
  const active = useStore(appStore, (st) => st.activeTabId)
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <Tab key={t.id} tab={t} active={t.id === active} />
      ))}
      <button className="new-tab-btn" title="New tab" onClick={() => actions.newTab()}>
        <PlusIcon />
      </button>
    </div>
  )
}

function Tab({ tab, active }: { tab: OpenTab; active: boolean }): JSX.Element {
  return (
    <div
      className={`tab${active ? ' active' : ''}`}
      onMouseDown={(e) => {
        if (e.button === 1) {
          actions.closeTab(tab.id)
          return
        }
        actions.activateTab(tab.id)
      }}
      title={tab.draft.url || tab.name}
    >
      <MethodMini method={tab.draft.method} />
      <span className="tab-name">{tab.name || 'Untitled'}</span>
      {tab.dirty || !tab.requestId ? <span className="tab-dot" title="Unsaved changes" /> : null}
      <button
        className="tab-close"
        title="Close (Ctrl+W)"
        onMouseDown={(e) => {
          e.stopPropagation()
          e.preventDefault()
          actions.closeTab(tab.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

