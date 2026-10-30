# Postmaster

A lightweight, local-first desktop API development client — an open Postman alternative built with **Electron 39 + React 19 + TypeScript**. All data stays on your machine: no account, no cloud sync, no telemetry.

**Current version:** `3.4.1`

![Postmaster icon](build/icon.png)

## Highlights

- Requests with method select, URL autocomplete (history / collections / dev shortcuts like `localhost:3000`), params synced both ways with the URL, bordered key/value tables with an always-present empty row (Params + Headers)
- Headers with enable-checks, Basic / Bearer / API-Key auth, JSON / raw / urlencoded / form-data bodies, per-request settings (timeout, redirects, SSL verify, cookie jar)
- Collections tree with folders, right-click context menus (rename / duplicate / copy URL / delete), full **drag & drop** across folders and collections — with guards against dropping into your own subtree and lost-drop fallbacks
- One-click **Save** (no dialog; the `▾` caret opens “Save as…”), name syncs with the tab title
- Response pane with windowed JSON viewing for huge bodies, headers/cookies/tests tabs, timing + size, history with configurable retention
- Environments + globals with `{{variable}}` resolution and unresolved-variable hints
- Sandboxed pre/post scripts (`vm` context, hard 2.5 s timeout) with a small `pm` API: variables get/set, request/response access, `pm.test` + `pm.expect`, console
- Persistent, encrypted-at-rest cookie jar (`safeStorage`); import from Postman v2.x / OpenAPI; export + cURL share
- Settings: General (timeouts, SSL, cookies, auto-save interval 2 s–5 min), Interface (UI/editor fonts, zoom 50–200% with `Ctrl +/−/0`, `Ctrl+wheel`), Proxy, OpenCode-style About (runtime/license/updates grid)
- Fully procedural original icon (`scripts/gen-icon.mjs`, zero dependencies, MIT — no third-party assets), transparent taskbar/logo mark in all sizes 16–256
- Secure Electron: `contextIsolation`, `sandbox: true` preload bridge, no `nodeIntegration`, validated IPC channel + store-name allowlists, CSP, TLS verification never disabled by default

## Hardened data layer

Persistence was adversarially reviewed (see `tests/robustness.test.tsx`): corrupt/hostile persisted JSON cannot crash the app. On load, collections, tabs, drafts, environments, globals and history are sanitized into a well-formed shape; numeric settings are clamped on write; disk writes are atomic (temp file + fsync + rename, `.bak` recovery, future-version files preserved verbatim).

## Development

```
npm install                # deps
npm test                   # vitest suite — 64 tests / 8 files (unit + RTL smoke)
npm run typecheck          # renderer TS
npm run typecheck:electron # main/preload TS
npm run dev                # vite + electron dev loop
npm run build              # dist/ renderer + dist-electron/ main
npm run icons              # regenerate build/icon.{ico,png,svg}
npm run dist               # NSIS installer → dist/Postman-v3.4.1.exe
```

Packaging uses electron-builder (`build` config in `package.json`); the installer embeds `build/icon.ico`.

## Project layout

```
src/                 React renderer (components / state actions / bridge / ui)
electron-main/       main process: window, IPC dispatch, Chromium-net HTTP service, sandboxed scripts, DataStore
shared/              types + pure logic shared by both sides (models, variables, URL utils, transfer/import)
tests/               vitest suite (unit + RTL smoke + robustness probes)
scripts/gen-icon.mjs procedural icon generator (PNG encoder + ICO packager)
build/               icon.ico / icon.png / icon.svg
```

## Roadmap — update notifications

Planned (not yet implemented — the app never phones home today):

1. **Update channel manifest** — a static `latest.json` (version, download URLs, SHA-256, release notes) checked at most twice a day via a plain HTTPS GET in the main process.
2. **In-app notification** — quiet toast + a dot on the title-bar gear when a newer version is found; click → dialog with release notes and Skip / Remind me later / Install.
3. **Update flow** — when distributing signed NSIS builds, defer to `electron-updater` (differential downloads, signature verification). Opt-in, off by default “check automatically”.
4. **Manual check** — “Check for updates” action in About.

## Not working yet (honest list)

- OAuth2 / Digest auth flows, file uploads (`multipart/form-data` file parts), auto-updater (above)
- `pm.sendRequest`, `pm.crypto`, `pm.moment` inside scripts (sandboxed subset only)
- Light theme (token groundwork exists), cloud sync, mock servers

## License

MIT
