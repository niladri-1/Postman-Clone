import type { AppSettings } from '../../shared/models'
import { pm } from '../api/bridge'

/**
 * Push the user's font/zoom preferences into the display. Fonts become CSS
 * custom properties; zoom goes through webContents zoom in Electron (so layout
 * reflows correctly) with a CSS-zoom fallback for plain-browser previews.
 */
export function applyDisplay(s: AppSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement.style
  root.setProperty('--font-ui', `'${s.uiFontFamily}', system-ui, sans-serif`)
  root.setProperty('--ui-font-size', `${s.uiFontSize}px`)
  root.setProperty('--font-mono', `'${s.editorFontFamily}', 'Consolas', monospace`)
  root.setProperty('--editor-font-size', `${s.editorFontSize}px`)

  const zoom = Math.min(200, Math.max(50, s.zoom || 100))
  if (pm) {
    void pm.setZoom(zoom)
    // keep the fallback property in sync for the rare non-Electron render
    document.body.style.removeProperty('zoom')
  } else {
    document.body.style.setProperty('zoom', `${zoom}%`)
  }
}

export const UI_FONT_CHOICES = [
  'Segoe UI',
  'Inter',
  'Arial',
  'Tahoma',
  'Verdana',
  'Candara',
  'Calibri',
  'IBM Plex Sans',
] as const

export const EDITOR_FONT_CHOICES = [
  'Cascadia Code',
  'Consolas',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Courier New',
] as const
