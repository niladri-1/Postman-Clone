/**
 * Secret-at-rest handling with Electron `safeStorage` (DPAPI-backed on
 * Windows). Environment variables marked `secret` have their `value` replaced
 * with an `enc:v1:<base64>` envelope on save and transparently decrypted on
 * load. Plain values are never transformed. If encryption is unavailable the
 * values are stored as-is (documented behavior).
 */
import type { Environment, EnvVar } from '../../shared/models'

export interface SecretBag {
  environments: Environment[]
  globals: EnvVar[]
}

const ENC_PREFIX = 'enc:v1:'

let cachedEncryptor: ((s: string) => Buffer) | null | undefined

function encryptor(): ((s: string) => Buffer) | null {
  if (cachedEncryptor !== undefined) return cachedEncryptor
  // lazy require so unit tests (no Electron runtime) can import this module
  const { safeStorage } = require('electron') as {
    safeStorage?: { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer }
  }
  cachedEncryptor =
    safeStorage?.isEncryptionAvailable() === true ? (s: string) => safeStorage.encryptString(s) : null
  return cachedEncryptor
}

function encryptOne(safe: ((s: string) => Buffer) | null, value: string): string {
  if (safe === null || !value) return value
  const buf = safe(value)
  if (!buf) return value
  return ENC_PREFIX + buf.toString('base64')
}

function decryptOne(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value
  try {
    const { safeStorage } = require('electron') as { safeStorage?: { decryptString(b: Buffer): string } }
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64')
    return safeStorage?.decryptString(buf) ?? ''
  } catch {
    return ''
  }
}

/** Encrypt all secret values before persisting. */
export function encryptSecretsForSave(bag: SecretBag): SecretBag {
  const safe = encryptor()
  const walker = (v: EnvVar): EnvVar => {
    if (!v.secret) return v
    return { ...v, value: encryptOne(safe, v.value) }
  }
  return {
    environments: bag.environments.map((e) => ({ ...e, variables: e.variables.map(walker) })),
    globals: bag.globals.map(walker),
  }
}

/** Decrypt secret values after loading. */
export function decryptSecretsForLoad(bag: SecretBag): SecretBag {
  const walker = (v: EnvVar): EnvVar => ({ ...v, value: decryptOne(v.value) })
  return {
    environments: bag.environments.map((e) => ({ ...e, variables: e.variables.map(walker) })),
    globals: bag.globals.map(walker),
  }
}
