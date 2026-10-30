import type { JSX } from 'react'
import { useEffect, useState, type ReactNode } from 'react'
import { actions, appStore } from './state/actions'

import { useStore } from './state/store'
import TitleBar from './components/TitleBar'
import TabBar from './components/TabBar'
import Sidebar from './components/Sidebar'
import RequestPane from './components/request/RequestPane'
import ResponsePane from './components/response/ResponsePane'
import StatusBar from './components/StatusBar'
import ConsoleDrawer from './components/ConsoleDrawer'
import Modals from './components/Modals'
import { applyDisplay } from './ui/typography'

export default function App(): JSX.Element {
  const ready = useStore(appStore, (s) => s.ready)
  const activeTabId = useStore(appStore, (s) => s.activeTabId)
  const tabs = useStore(appStore, (s) => s.tabs)
  const sidebarWidth = useStore(appStore, (s) => s.sidebarWidth)
  const consoleOpen = useStore(appStore, (s) => s.consoleOpen)

  useEffect(() => {
    actions.hydrate()
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const settings = useStore(appStore, (s) => s.settings)

  useEffect(() => {
    applyDisplay(settings)
  }, [settings])

  // Ctrl +/−/0 adjust the interface zoom on the fly; Ctrl+wheel steps by 10 %
  useEffect(() => {
    const step = (delta: number): void => {
      const cur = appStore.get().settings.zoom || 100
      actions.settings({ zoom: Math.min(200, Math.max(50, cur + delta)) })
    }
    const reset = (): void => actions.settings({ zoom: 100 })
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        step(10)
      } else if (e.key === '-') {
        e.preventDefault()
        step(-10)
      } else if (e.key === '0') {
        e.preventDefault()
        reset()
      }
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      step(e.deltaY < 0 ? 10 : -10)
    }
    // manual-mode safety net: pending edits are written when the window closes/hides
    const flush = (): void => actions.saveAll()
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <TabBar />
      <div className="ws">
        {sidebarWidth > 0 ? <Sidebar /> : <div />}
        <div className="content">
          {ready && !activeTab ? (
            <div className="workspace-empty">
              <div className="big">✉</div>
              <div>Nothing open — create a request with the <strong>+</strong> button above</div>
            </div>
          ) : activeTab ? (
            <Split>
              <RequestPane tab={activeTab} />
              <ResponsePane tabId={activeTab.id} />
            </Split>
          ) : (
            <div className="workspace-empty">
              <div className="big">◌</div>
              <div>Loading…</div>
            </div>
          )}
        </div>
      </div>
      <StatusBar />
      {consoleOpen ? <ConsoleDrawer /> : null}
      <Modals />
    </div>
  )
}

/** Vertical split with a draggable divider; proportions kept in local state. */
function Split({ children }: { children: [ReactNode, ReactNode] | ReactNode[] }): JSX.Element {
  const [topPct, setTopPct] = useState(56)
  const [a, b] = children
  return (
    <div className="split" style={{ gridTemplateRows: `${topPct}% 4px 1fr` }}
    >
      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{a}</div>
      <div
        className="v-resizer"
        onMouseDown={(e) => {
          e.preventDefault()
          const startY = e.clientY
          const startTop = topPct
          const px = (): number => {
            const el = document.querySelector('.split')
            return el ? el.clientHeight : 600
          }
          const total = px()
          const onMove = (ev: MouseEvent): void => {
            const pct = Math.min(85, Math.max(20, startTop + ((ev.clientY - startY) / total) * 100))
            setTopPct(pct)
          }
          const onUp = (): void => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
          }
          document.addEventListener('mousemove', onMove)
          document.addEventListener('mouseup', onUp)
        }}
      />
      <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{b}</div>
    </div>
  )
}

