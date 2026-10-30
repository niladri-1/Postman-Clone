/** Tiny inline SVG icon set — keeps bundle small, no external icon deps. */
import type { JSX } from 'react'

const S = (children: JSX.Element, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const MenuIcon = () => S(<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>)
export const GearIcon = () => S(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>)
export const MinIcon = () => S(<line x1="5" y1="12" x2="19" y2="12" />, 12)
export const MaxIcon = () => S(<rect x="6" y="6" width="12" height="12" rx="1" />, 10)
export const CloseIcon = () => S(<><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>, 12)
export const PlusIcon = () => S(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>)
export const ChevIcon = () => S(<polyline points="9 6 15 12 9 18" />, 11)
export const CollectionIcon = () => S(<><path d="M4 4h3l2 2h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="M8 12h8" /><path d="M8 16h5" /></>)
export const FolderIcon = () => S(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />)
export const FolderOpenIcon = () => S(<><path d="M2 9V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v1" /><path d="M2 13l2.6-5.6A2 2 0 0 1 6.4 6h12.2a2 2 0 0 1 1.9 2.7L18 13H2z" /><path d="M2 13h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" /></>)
export const ClockIcon = () => S(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>)
export const LayersIcon = () => S(<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>)
export const GlobeIcon = () => S(<><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" /></>)
export const TerminalIcon = () => S(<><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>)
export const ConsoleIcon = () => S(<><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="6 9 9 12 6 15" /></>)
export const SearchIcon = () => S(<><circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16.5" y2="16.5" /></>)
export const CopyIcon = () => S(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>)
export const DownloadIcon = () => S(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>)
export const ImportIcon = () => S(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>)
export const ShareIcon = () => S(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="10.6" x2="15.4" y2="6.5" /><line x1="8.6" y1="13.4" x2="15.4" y2="17.5" /></>)
export const TrashIcon = () => S(<><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>)
export const MoreIcon = () => S(<><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>)
export const CookieIcon = () => S(<><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5z" /><circle cx="8.5" cy="9" r="0.6" /><circle cx="15.5" cy="14.5" r="0.6" /><circle cx="9.5" cy="15.5" r="0.6" /></>)
export const MinusIcon = () => S(<line x1="5" y1="12" x2="19" y2="12" />, 12)
export const SendIcon = () => S(<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>, 13)
export const StopIcon = () => S(<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />, 12)
export const FileIcon = () => S(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>)
export const ReqIcon = () => S(<><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><ellipse cx="12" cy="12" rx="4" ry="9" /></>)
