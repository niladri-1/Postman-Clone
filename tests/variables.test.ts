import { describe, expect, it } from 'vitest'
import { resolveVariables, resolveDraft, varsToScope, lookupVariable } from '../shared/variables'
import { DEFAULT_REQUEST, type RequestDraft } from '../shared/models'

describe('resolveVariables', () => {
  it('prefers runtime over environment over globals', () => {
    const scope = {
      globals: { host: 'g' },
      environment: { host: 'e', onlyEnv: 'env-val' },
      runtime: { host: 'r' },
    }
    expect(resolveVariables('{{host}}-{{onlyEnv}}', scope).value).toBe('r-env-val')
  })

  it('reports unresolved names', () => {
    const r = resolveVariables('https://{{base}}/x?q={{missing}}', { globals: {} })
    expect(r.value).toBe('https://{{base}}/x?q={{missing}}')
    expect(r.unresolved.sort()).toEqual(['base', 'missing'])
  })

  it('tolerates whitespace inside braces', () => {
    expect(resolveVariables('{{  h }}', { globals: { h: 'ok' } }).value).toBe('ok')
  })
})

describe('lookupVariable', () => {
  it('walks runtime > environment > globals', () => {
    expect(lookupVariable('a', { globals: { a: '1' }, environment: { a: '2' }, runtime: { a: '3' } })).toBe('3')
    expect(lookupVariable('a', { globals: { a: '1' }, environment: { a: '2' } })).toBe('2')
    expect(lookupVariable('a', { globals: { a: '1' } })).toBe('1')
    expect(lookupVariable('x', {})).toBeUndefined()
  })
})

describe('resolveDraft', () => {
  it('resolves url, headers and auth fields', () => {
    const draft: RequestDraft = {
      ...DEFAULT_REQUEST,
      method: 'POST',
      url: 'https://{{host}}/api',
      headers: [{ id: 'h1', key: 'X-Tenant', value: '{{tenant}}', enabled: true }],
      auth: { type: 'bearer', token: '{{tok}}' },
    }
    const out = resolveDraft(draft, { globals: { host: 'e.com', tenant: 'acme', tok: 'knock' } })
    expect(out.url).toBe('https://e.com/api')
    expect(out.headers[0].value).toBe('acme')
    expect(out.auth.token).toBe('knock')
  })

  it('collects unresolved only once', () => {
    const draft: RequestDraft = {
      ...DEFAULT_REQUEST,
      url: 'https://{{h}}/{{h}}',
      headers: [],
    }
    const out = resolveDraft(draft, {})
    expect(out.url.includes('{{h}}')).toBe(true)
  })

  it('keeps urlencoded and json bodies untouched unless json/raw are the active type', () => {
    const draft: RequestDraft = {
      ...DEFAULT_REQUEST,
      body: { type: 'urlencoded', raw: '{{r}}', json: '{{j}}', urlencoded: [{ id: 'k', key: 'p', value: '{{v}}', enabled: true }], form: [] },
    }
    const out = resolveDraft(draft, { globals: { v: 'val' } })
    expect(out.body.raw).toBe('{{r}}')
    expect(out.body.json).toBe('{{j}}')
  })
})

describe('varsToScope', () => {
  it('maps EnvVar list to record', () => {
    expect(varsToScope([
      { id: '1', key: 'a', value: '1', secret: false },
      { id: '2', key: 'b', value: '2', secret: true },
    ])).toEqual({ a: '1', b: '2' })
  })
})
