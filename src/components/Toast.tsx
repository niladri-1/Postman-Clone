import type { JSX } from 'react'
import { appStore } from '../state/actions'
import { useStore } from '../state/store'

export default function Toast(): JSX.Element | null {
  const toasts = useStore(appStore, (s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

