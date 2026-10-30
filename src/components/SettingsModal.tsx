import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { actions, appStore } from '../state/actions'
import { useStore } from '../state/store'
import { Toggle } from './request/Panels'
import { pm } from '../api/bridge'
import { UI_FONT_CHOICES, EDITOR_FONT_CHOICES } from '../ui/typography'
import type { AppSettings } from '../../shared/models'

const SECTIONS = ['General', 'Interface', 'Proxy', 'About'] as const
type Section = (typeof SECTIONS)[number]

export default function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('General')

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">Postmaster settings</div>
        <div className="settings-layout">
          <nav className="settings-nav">
            {SECTIONS.map((sec) => (
              <button key={sec} className={`settings-nav-item${section === sec ? ' active' : ''}`} onClick={() => setSection(sec)}>
                {sec}
              </button>
            ))}
          </nav>
          <div className="settings-page">
            {section === 'General' ? <General /> : null}
            {section === 'Interface' ? <InterfaceSettings /> : null}
            {section === 'Proxy' ? <ProxySettings /> : null}
            {section === 'About' ? <About /> : null}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="settings-row">
      <div className="grow">
        <div className="label">{label}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {children}
    </div>
  )
}

function General(): JSX.Element {
  const s = useStore(appStore, (st) => st.settings)
  const set = (patch: Partial<AppSettings>): void => actions.settings(patch)

  return (
    <div>
      <div className="settings-section-title">Requests</div>
      <Row label="Request timeout in ms" sub="0 = no timeout (updated app default; per-request values win)">
        <input className="num-input" type="number" min={0} value={s.requestTimeoutMs} onChange={(e) => set({ requestTimeoutMs: Number(e.target.value) || 0 })} />
      </Row>
      <Row label="Max response size (MB)" sub="0 = unlimited; larger responses are truncated">
        <input className="num-input" type="number" min={0} value={s.maxResponseSizeMb} onChange={(e) => set({ maxResponseSizeMb: Number(e.target.value) || 0 })} />
      </Row>
      <Row label="SSL certificate verification" sub="Verify TLS certificates on requests (off = insecure; explicit opt-out)">
        <Toggle checked={s.sslVerify} onChange={(v) => set({ sslVerify: v })} />
      </Row>
      <Row label="Send cookies" sub="Use the persistent Postmaster cookie jar">
        <Toggle checked={!s.disableCookies} onChange={(v) => set({ disableCookies: !v })} />
      </Row>
      <div className="settings-section-title">Data</div>
      <Row label="Auto save" sub="How soon unsaved changes are written to disk. When off, Postmaster writes everything on close instead.">
        <select
          className="select-input"
          value={s.autosave ? String(s.autosaveMs >= 500 ? s.autosaveMs : 2000) : 'off'}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'off') set({ autosave: false })
            else set({ autosave: true, autosaveMs: Number(v) })
          }}
        >
          <option value="off">Off (write on close)</option>
          <option value="2000">Every 2 s</option>
          <option value="5000">Every 5 s</option>
          <option value="15000">Every 15 s</option>
          <option value="30000">Every 30 s</option>
          <option value="60000">Every 1 min</option>
          <option value="300000">Every 5 min</option>
        </select>
      </Row>
      <Row label="History entries kept" sub="Older entries are trimmed automatically">
        <input className="num-input" type="number" min={10} value={s.historyLimit} onChange={(e) => set({ historyLimit: Number(e.target.value) || 500 })} />
      </Row>
      <Row label="JSON editor tab size" sub="Pretty-printed response indentation">
        <select className="select-input" value={s.tabSize} onChange={(e) => set({ tabSize: Number(e.target.value) })}>
          {[2, 4].map((n) => (
            <option key={n} value={n}>{n} spaces</option>
          ))}
        </select>
      </Row>
    </div>
  )
}

function InterfaceSettings(): JSX.Element {
  const s = useStore(appStore, (st) => st.settings)
  const set = (patch: Partial<AppSettings>): void => actions.settings(patch)

  const clamp = (v: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback

  return (
    <div>
      <div className="settings-section-title">Zoom</div>
      <Row label="Interface zoom" sub="Scales the whole app · Ctrl + / Ctrl − / Ctrl 0 or Ctrl + mouse wheel to adjust on the fly">
        <select className="select-input" value={String(s.zoom || 100)} onChange={(e) => set({ zoom: Number(e.target.value) })}>
          {[75, 90, 100, 110, 125, 150, 175, 200].map((z) => (
            <option key={z} value={z}>{z}%</option>
          ))}
        </select>
      </Row>

      <div className="settings-section-title">App chrome</div>
      <Row label="Font family" sub="Used across the whole interface">
        <select className="select-input" value={s.uiFontFamily} onChange={(e) => set({ uiFontFamily: e.target.value })}>
          {UI_FONT_CHOICES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </Row>
      <Row label="Font size" sub={`Currently ${s.uiFontSize} px`}>
        <input className="num-input" type="number" min={10} max={20} value={s.uiFontSize} onChange={(e) => set({ uiFontSize: clamp(e.target.valueAsNumber, 10, 20, 13) })} />
      </Row>

      <div className="settings-section-title">Editor</div>
      <Row label="Font family" sub="URL bar, request editors and code panes">
        <select className="select-input" value={s.editorFontFamily} onChange={(e) => set({ editorFontFamily: e.target.value })}>
          {EDITOR_FONT_CHOICES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </Row>
      <Row label="Font size" sub={`Currently ${s.editorFontSize} px`}>
        <input className="num-input" type="number" min={9} max={24} value={s.editorFontSize} onChange={(e) => set({ editorFontSize: clamp(e.target.valueAsNumber, 9, 24, 13) })} />
      </Row>
      <Row label="Preview">
        <div className="font-preview">
          <span className="font-preview-ui">The quick brown fox — GET https://api.example.com</span>
          <span className="font-preview-mono">POST /users {`{ "name": "value" }`}</span>
        </div>
      </Row>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
        Changes apply immediately and are saved automatically.
      </div>
    </div>
  )
}

function ProxySettings(): JSX.Element {
  const proxy = useStore(appStore, (st) => st.settings.proxy)
  const set = (patch: Partial<AppSettings['proxy']>): void => actions.settings({ proxy: { ...proxy, ...patch } })

  return (
    <div>
      <div className="settings-section-title">Proxy</div>
      <Row label="Proxy mode" sub="System uses Electron's default proxy resolution">
        <select className="select-input" value={proxy.mode} onChange={(e) => set({ mode: e.target.value as AppSettings['proxy']['mode'] })}>
          <option value="system">System (default)</option>
          <option value="none">Direct (no proxy)</option>
          <option value="manual">Manual</option>
        </select>
      </Row>
      {proxy.mode === 'manual' ? (
        <>
          <Row label="Host">
            <input className="text-input" style={{ width: 240 }} value={proxy.host} placeholder="proxy.example.com" onChange={(e) => set({ host: e.target.value })} />
          </Row>
          <Row label="Port">
            <input className="num-input" type="number" min={1} max={65535} value={proxy.port || ''} placeholder="8080" onChange={(e) => set({ port: Number(e.target.value) || 0 })} />
          </Row>
          <Row label="Bypass rules" sub="Comma-separated hostnames that skip the proxy">
            <input className="text-input" style={{ width: 240 }} value={proxy.bypass} placeholder="localhost,*.local" onChange={(e) => set({ bypass: e.target.value })} />
          </Row>
        </>
      ) : null}
    </div>
  )
}

function About(): JSX.Element {
  const [info, setInfo] = useState<{ version: string; electron: string; chrome: string; node: string } | null>(null)
  useEffect(() => {
    void pm?.appInfo().then(setInfo)
  }, [])
  return (
    <div className="about">
      <div className="about-hero">
        <div className="about-logo">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
            <path d="M2.5 6.5l9.5 6 9.5-6" />
          </svg>
        </div>
        <div>
          <div className="about-name">Postmaster</div>
          <div className="about-version">v{info?.version ?? '…'}</div>
        </div>
      </div>

      <p className="about-tagline">A lightweight, local-first desktop API client. All data stays on this machine — no account, no cloud sync, no telemetry.</p>

      <div className="about-grid">
        <div className="about-cell">
          <span className="about-key">Runtime</span>
          <span className="about-val">Electron {info?.electron ?? '…'} · Chromium {info?.chrome ?? '…'} · Node {info?.node ?? '…'}</span>
        </div>
        <div className="about-cell">
          <span className="about-key">License</span>
          <span className="about-val">MIT</span>
        </div>
        <div className="about-cell">
          <span className="about-key">Updates</span>
          <span className="about-val">In-app update notifications are planned for a future release — the app never phones home today.</span>
        </div>
      </div>
    </div>
  )
}

