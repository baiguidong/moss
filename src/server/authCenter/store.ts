import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type AuthCenterOrganization = {
  id: string
  name: string
  createdAt: number
}

export type AuthCenterUser = {
  id: string
  orgId: string
  email: string
  name: string
  role: string
  status: 'active' | 'disabled'
  createdAt: number
  passwordHash: string | null
  passwordUpdatedAt: number | null
  lastLoginAt: number | null
}

export type AuthCenterApiKey = {
  id: string
  orgId: string
  userId: string
  name: string
  prefix: string
  secretHash: string
  scopes: string[]
  status: 'active' | 'revoked'
  createdAt: number
  lastUsedAt: number | null
}

export type AuthCenterStore = {
  version: 2
  issuer: string
  jwtSecret: string
  organizations: AuthCenterOrganization[]
  users: AuthCenterUser[]
  apiKeys: AuthCenterApiKey[]
}

export type AuthCenterBootstrap = {
  created: boolean
  bootstrapAdminApiKey?: string
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toPasswordHashRecord(password: string, salt?: string): string {
  const actualSalt = salt ?? randomBytes(16).toString('hex')
  const derived = scryptSync(password, actualSalt, 64).toString('hex')
  return `scrypt$${actualSalt}$${derived}`
}

export function hashPassword(password: string): string {
  return toPasswordHashRecord(password)
}

export function verifyPassword(
  password: string,
  passwordHash: string | null | undefined,
): boolean {
  if (!passwordHash) {
    return false
  }
  const match = passwordHash.match(/^scrypt\$([^$]+)\$([0-9a-f]+)$/)
  if (!match) {
    return false
  }
  const [, salt, expectedHex] = match
  const actual = Buffer.from(
    toPasswordHashRecord(password, salt).split('$')[2] || '',
    'hex',
  )
  const expected = Buffer.from(expectedHex || '', 'hex')
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  )
}

export function createTemporaryPassword(length = 20): string {
  return randomBytes(length).toString('base64url').slice(0, length)
}

export function getDefaultAuthCenterStorePath(): string {
  return join(getClaudeConfigHomeDir(), 'auth-center', 'store.json')
}

function createApiKeyValue(id: string, secret: string): string {
  return `moss_sk_${id}.${secret}`
}

export function createApiKeyRecord(input: {
  orgId: string
  userId: string
  name: string
  scopes: string[]
}): {
  apiKey: AuthCenterApiKey
  plainTextKey: string
} {
  const id = randomUUID()
  const secret = randomBytes(24).toString('base64url')
  const plainTextKey = createApiKeyValue(id, secret)

  return {
    apiKey: {
      id,
      orgId: input.orgId,
      userId: input.userId,
      name: input.name,
      prefix: plainTextKey.slice(0, 16),
      secretHash: sha256(secret),
      scopes: input.scopes,
      status: 'active',
      createdAt: Date.now(),
      lastUsedAt: null,
    },
    plainTextKey,
  }
}

async function writeStore(
  storePath: string,
  store: AuthCenterStore,
): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

export async function ensureAuthCenterStore(
  storePath = getDefaultAuthCenterStorePath(),
): Promise<{
  store: AuthCenterStore
  bootstrap: AuthCenterBootstrap
}> {
  try {
    const existing = await readAuthCenterStore(storePath)
    return {
      store: existing,
      bootstrap: { created: false },
    }
  } catch {
    const now = Date.now()
    const orgId = randomUUID()
    const adminUserId = randomUUID()
    const bootstrapAdminEmail = 'admin@example.com'
    const bootstrapAdminPassword = createTemporaryPassword()
    const { apiKey, plainTextKey } = createApiKeyRecord({
      orgId,
      userId: adminUserId,
      name: 'bootstrap-admin',
      scopes: ['*'],
    })

    const store: AuthCenterStore = {
      version: 1,
      issuer: 'moss-auth-center',
      jwtSecret: randomBytes(32).toString('base64url'),
      organizations: [
        {
          id: orgId,
          name: 'Default Organization',
          createdAt: now,
        },
      ],
      users: [
        {
          id: adminUserId,
          orgId,
          email: bootstrapAdminEmail,
          name: 'Bootstrap Admin',
          role: 'admin',
          status: 'active',
          createdAt: now,
          passwordHash: hashPassword(bootstrapAdminPassword),
          passwordUpdatedAt: now,
          lastLoginAt: null,
        },
      ],
      apiKeys: [apiKey],
    }

    await writeStore(storePath, store)
    return {
      store,
      bootstrap: {
        created: true,
        bootstrapAdminApiKey: plainTextKey,
        bootstrapAdminEmail,
        bootstrapAdminPassword,
      },
    }
  }
}

export async function readAuthCenterStore(
  storePath = getDefaultAuthCenterStorePath(),
): Promise<AuthCenterStore> {
  const raw = await readFile(storePath, 'utf8')
  const parsed = JSON.parse(raw) as
    | AuthCenterStore
    | {
        version?: number
        issuer?: string
        jwtSecret?: string
        organizations?: AuthCenterOrganization[]
        users?: Array<
          Omit<AuthCenterUser, 'passwordHash' | 'passwordUpdatedAt' | 'lastLoginAt'> &
            Partial<
              Pick<
                AuthCenterUser,
                'passwordHash' | 'passwordUpdatedAt' | 'lastLoginAt'
              >
            >
        >
        apiKeys?: AuthCenterApiKey[]
      }
  if (
    (parsed.version !== 1 && parsed.version !== 2) ||
    typeof parsed.issuer !== 'string' ||
    typeof parsed.jwtSecret !== 'string' ||
    !Array.isArray(parsed.organizations) ||
    !Array.isArray(parsed.users) ||
    !Array.isArray(parsed.apiKeys)
  ) {
    throw new Error(`Invalid auth center store: ${storePath}`)
  }
  return {
    version: 2,
    issuer: parsed.issuer,
    jwtSecret: parsed.jwtSecret,
    organizations: parsed.organizations,
    users: parsed.users.map(user => ({
      ...user,
      passwordHash: user.passwordHash ?? null,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
    })),
    apiKeys: parsed.apiKeys,
  }
}

export async function updateAuthCenterStore(
  mutator: (store: AuthCenterStore) => AuthCenterStore,
  storePath = getDefaultAuthCenterStorePath(),
): Promise<AuthCenterStore> {
  const store = await readAuthCenterStore(storePath)
  const next = mutator(store)
  await writeStore(storePath, next)
  return next
}

export function sanitizeApiKey(apiKey: AuthCenterApiKey): Omit<
  AuthCenterApiKey,
  'secretHash'
> {
  const { secretHash: _secretHash, ...rest } = apiKey
  return rest
}

export function sanitizeUser(
  user: AuthCenterUser,
): Omit<AuthCenterUser, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = user
  return rest
}

export function findApiKeyRecord(
  store: AuthCenterStore,
  plainTextKey: string,
): AuthCenterApiKey | null {
  const match = plainTextKey.match(/^moss_sk_([^\.]+)\.(.+)$/)
  if (!match) {
    return null
  }

  const [, id, secret] = match
  const apiKey = store.apiKeys.find(record => record.id === id)
  if (!apiKey || apiKey.status !== 'active') {
    return null
  }

  return apiKey.secretHash === sha256(secret) ? apiKey : null
}
