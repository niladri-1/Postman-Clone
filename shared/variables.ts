import type { EnvVar, Environment, RequestDraft, AuthConfig } from './models'

const FALLBACK_BODY: RequestDraft['body'] = { type: 'none', json: '', raw: '', urlencoded: [], form: [] }
const FALLBACK_AUTH: AuthConfig = { type: 'none' }

/** Scope chain for variable resolution: environment > globals > runtime (collection) > undefined */
export interface VarScope {
  globals?: Record<string, string>
  environment?: Record<string, string>
  runtime?: Record<string, string>
}

export const envToScope = (envs: Environment[]): Record<string, string> | undefined => {
  if (!envs.length) return undefined
  const map: Record<string, string> = {}
  for (const e of envs) for (const v of e.variables) map[v.key] = v.value
  return map
}

export const varsToScope = (vars: EnvVar[]): Record<string, string> =>
  Object.fromEntries(vars.map((v) => [v.key, v.value]))

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

export interface Resolution {
  value: string
  unresolved: string[]
}

/**
 * Resolve {{var}} occurrences.
 * Resolution order: runtime (set by scripts) > environment > globals.
 */
export function resolveVariables(raw: string, scope: VarScope): Resolution {
  const unresolved = new Set<string>()
  const value = raw.replace(VAR_RE, (_m, name: string) => {
    const key = name.trim()
    const runtimeV = scope.runtime?.[key]
    const envV = scope.environment?.[key]
    const globV = scope.globals?.[key]
    if (typeof runtimeV === 'string') return runtimeV
    if (typeof envV === 'string') return envV
    if (typeof globV === 'string') return globV
    unresolved.add(key)
    return `{{${name}}}`
  })
  return { value, unresolved: [...unresolved] }
}

/** Single-value accessor used by URL parsing, auth building etc. */
export function lookupVariable(name: string, scope: VarScope): string | undefined {
  return scope.runtime?.[name] ?? scope.environment?.[name] ?? scope.globals?.[name]
}

/** Resolve every aspect of a draft (url, headers, query, body, auth fields). */
export function resolveDraft(draft: RequestDraft, scope: VarScope): RequestDraft {
  const unresolved: string[] = []
  const push = (u: string[]) => {
    for (const x of u) if (!unresolved.includes(x)) unresolved.push(x)
  }
  const res = (s: string): string => {
    const r = resolveVariables(s, scope)
    push(r.unresolved)
    return r.value
  }
  // tolerate partial/hostile drafts: missing arrays become empty, missing blocks fall through
  const body = draft.body && typeof draft.body === 'object' ? draft.body : FALLBACK_BODY
  const auth = draft.auth && typeof draft.auth === 'object' ? draft.auth : FALLBACK_AUTH
  return {
    ...draft,
    url: res(draft.url ?? ''),
    headers: (draft.headers ?? []).map((h) => ({ ...h, key: res(h?.key ?? ''), value: res(h?.value ?? '') })),
    query: (draft.query ?? [])
      .filter((q) => q && q.enabled)
      .map((q) => ({ ...q, key: res(q.key ?? ''), value: res(q.value ?? ''), description: undefined })),
    body: {
      ...body,
      json: body.type === 'json' ? res(body.json ?? '') : body.json,
      raw: body.type === 'raw' ? res(body.raw ?? '') : body.raw,
    },
    auth:
      auth.type === 'basic'
        ? {
            ...auth,
            username: res(auth.username ?? ''),
            password: res(auth.password ?? ''),
          }
        : auth.type === 'bearer'
          ? { ...auth, token: res(auth.token ?? '') }
          : auth.type === 'apiKey'
            ? {
                ...auth,
                apiKeyValue: res(auth.apiKeyValue ?? ''),
              }
            : auth,
  }
}
