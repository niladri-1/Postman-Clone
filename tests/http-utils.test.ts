import { describe, expect, it } from 'vitest'
import { splitUrl, buildUrl, toCurl, staticAuthHeaders } from '../shared/http-utils'
import { DEFAULT_REQUEST } from '../shared/models'

describe('splitUrl', () => {
  it('splits query string into pairs', () => {
    const { base, pairs } = splitUrl('https://x.io/api?page=2&tag=a b&flag')
    expect(base).toBe('https://x.io/api')
    expect(pairs).toEqual([
      { id: expect.any(String), key: 'page', value: '2', description: '', enabled: true },
      { id: expect.any(String), key: 'tag', value: 'a b', description: '', enabled: true },
      { id: expect.any(String), key: 'flag', value: '', description: '', enabled: true },
    ])
  })

  it('returns null pairs when no query', () => {
    const r = splitUrl('https://x.io/')
    expect(r.base).toBe('https://x.io/')
    expect(r.pairs).toBeNull()
  })
})

describe('buildUrl', () => {
  it('rebuilds with enabled rows only', () => {
    const rows = [
      { id: '1', key: 'a', value: '1', description: '', enabled: true },
      { id: '2', key: 'b', value: '2', description: '', enabled: false },
    ]
    expect(buildUrl('https://x.io', rows)).toBe('https://x.io?a=1')
  })

  it('key without value serializes bare', () => {
    expect(buildUrl('https://x.io', [{ id: '1', key: 'flag', value: '', description: '', enabled: true }])).toBe('https://x.io?flag')
  })

  it('base without query when no enabled rows', () => {
    expect(buildUrl('https://x.io', [])).toBe('https://x.io')
  })
})

describe('toCurl', () => {
  it('renders method, headers and json body', () => {
    const curl = toCurl({
      ...DEFAULT_REQUEST,
      method: 'POST',
      url: 'https://x.io/api',
      headers: [{ id: '1', key: 'X-Test', value: '1', enabled: true }],
      body: { type: 'json', raw: '', json: '{"a":1}', urlencoded: [], form: [] },
    })
    expect(curl).toContain('curl')
    expect(curl).toContain('-X POST')
    expect(curl).toContain('-H "X-Test: 1"')
    expect(curl).toContain('-H "Content-Type: application/json"')
    expect(curl).toContain('--data-raw "{\\"a\\":1}"')
    expect(curl.endsWith('"https://x.io/api"')).toBe(true)
  })

  it('GET renders no -X flag and skips disabled headers', () => {
    const curl = toCurl({
      ...DEFAULT_REQUEST,
      headers: [{ id: '1', key: 'X-Off', value: 'v', enabled: false }],
    })
    expect(curl).not.toContain('-X')
    expect(curl).not.toContain('X-Off')
  })
})

describe('staticAuthHeaders', () => {
  it('encodes basic auth', () => {
    expect(staticAuthHeaders({ type: 'basic', username: 'u', password: 'p' })).toEqual({ Authorization: 'Basic dTpw' })
  })

  it('bearer token', () => {
    expect(staticAuthHeaders({ type: 'bearer', token: 'tok' })).toEqual({ Authorization: 'Bearer tok' })
  })

  it('api key header uses custom name', () => {
    expect(staticAuthHeaders({ type: 'apiKey', apiKeyLocation: 'header', apiKeyIn: 'X-Key', apiKeyValue: 'v' }))
      .toEqual({ 'X-Key': 'v' })
  })

  it('api key query contributes nothing to headers', () => {
    expect(staticAuthHeaders({ type: 'apiKey', apiKeyLocation: 'query', apiKeyIn: 'k', apiKeyValue: 'v' })).toEqual({})
  })

  it('none auth yields empty', () => {
    expect(staticAuthHeaders({ type: 'none' })).toEqual({})
  })
})
