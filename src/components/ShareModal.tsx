import type { JSX } from 'react'
import { useState } from 'react'
import { appStore } from '../state/actions'
import { useStore } from '../state/store'
import { toCurl } from '../../shared/http-utils'

/** Share dialog: cURL export of the current draft. */
export default function ShareModal({ tabId, onClose }: { tabId: string; onClose: () => void }): JSX.Element {
  const draft = useStore(appStore, (s) => s.tabs.find((t) => t.id === tabId)?.draft)
  const [copied, setCopied] = useState(false)
  if (!draft) return <></>
  const curl = toCurl(draft)

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">Share as cURL</div>
        <div className="modal-body">
          <textarea
            className="bulk"
            style={{ height: 220, whiteSpace: 'pre' }}
            readOnly
            value={curl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <p style={{ color: 'var(--text-3)', fontSize: 11.5, marginTop: 8 }}>
            Secrets may be visible in the command — share carefully.
          </p>
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(curl).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              })
            }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

