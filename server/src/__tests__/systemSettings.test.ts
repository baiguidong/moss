import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const originalMossServerHome = process.env.MOSS_SERVER_HOME
let tempRoot: string | undefined

afterEach(async () => {
  restoreEnv('MOSS_SERVER_HOME', originalMossServerHome)
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }
})

describe('system settings model layout', () => {
  test('reads models.text/models.image and saves only the new layout', async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'moss-settings-'))
    const serverHome = join(tempRoot, 'server-home')
    process.env.MOSS_SERVER_HOME = serverHome
    await mkdir(serverHome, { recursive: true })

    await writeFile(
      join(serverHome, 'settings.json'),
      JSON.stringify(
        {
          bypassPermissions: false,
          models: {
            text: {
              baseUrl: 'https://model.initial.test',
              apiKey: 'model-key-initial',
              model: 'initial-model',
              maxTurns: 12,
              thinking: {
                mode: 'enabled',
                budgetTokens: 4096,
              },
            },
            image: {
              provider: 'openai',
              url: 'https://image-legacy-field.test',
              baseUrl: 'https://image.initial.test',
              apiKey: 'image-key-initial',
              model: 'image-initial',
            },
          },
          env: {
            KEEP_ME: 'yes',
            MOSS_SERVER_URL: 'http://server.initial.test',
            MOSS_SERVER_AUTH_TOKEN: 'server-token-initial',
          },
          skillStore: {
            tenantId: 'tenant-initial',
          },
          serverRuntime: {
            backend: 'host',
            dockerImage: '',
            defaultProfileMode: 'session',
            allowedProfileModes: ['session', 'user'],
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    const mod = await import(`../systemSettings.js?case=${randomUUID()}`)
    expect(mod.getSystemSettings()).toMatchObject({
      model: 'initial-model',
      maxTurns: 12,
      thinkingMode: 'enabled',
      thinkingBudgetTokens: 4096,
      url: 'https://model.initial.test',
      apiKey: 'model-key-initial',
      image: {
        provider: 'openai',
        url: 'https://image.initial.test',
        apiKey: 'image-key-initial',
        model: 'image-initial',
      },
    })
    expect(mod.getSystemSettings()).not.toHaveProperty('skillStore')
    expect(mod.getSystemSettings().serverRuntime).toEqual({
      dockerImage: 'moss-runtime:0.1.8',
    })

    const updated = mod.updateSystemSettings({
      bypassPermissions: true,
      models: {
        text: {
          baseUrl: 'https://model.updated.test',
          apiKey: 'model-key-updated',
          model: 'updated-model',
          maxTurns: 34,
          thinking: {
            mode: 'disabled',
            budgetTokens: 8192,
          },
        },
        image: {
          provider: 'openai',
          baseUrl: 'https://image.updated.test',
          apiKey: 'image-key-updated',
          model: 'image-updated',
        },
      },
    })

    expect(updated).toMatchObject({
      bypassPermissions: true,
      model: 'updated-model',
      maxTurns: 34,
      thinkingMode: 'disabled',
      thinkingBudgetTokens: 8192,
      url: 'https://model.updated.test',
      apiKey: 'model-key-updated',
      image: {
        provider: 'openai',
        url: 'https://image.updated.test',
        apiKey: 'image-key-updated',
        model: 'image-updated',
      },
    })

    const persisted = JSON.parse(
      await readFile(join(serverHome, 'settings.json'), 'utf8'),
    )
    expect(persisted.models.text).toEqual({
      baseUrl: 'https://model.updated.test',
      apiKey: 'model-key-updated',
      model: 'updated-model',
      maxTurns: 34,
      thinking: {
        mode: 'disabled',
        budgetTokens: 8192,
      },
    })
    expect(persisted.models.image).toEqual({
      provider: 'openai',
      baseUrl: 'https://image.updated.test',
      apiKey: 'image-key-updated',
      model: 'image-updated',
    })
    expect(persisted.model).toBeUndefined()
    expect(persisted.maxTurns).toBeUndefined()
    expect(persisted.thinkingMode).toBeUndefined()
    expect(persisted.thinkingBudgetTokens).toBeUndefined()
    expect(persisted.url).toBeUndefined()
    expect(persisted.apiKey).toBeUndefined()
    expect(persisted.image).toBeUndefined()
    expect(persisted.skillStore).toBeUndefined()
    expect(persisted.serverRuntime).toEqual({
      dockerImage: 'moss-runtime:0.1.8',
    })
    expect(persisted.env).toEqual({
      KEEP_ME: 'yes',
    })
    expect(
      Object.keys(persisted.env || {}).some(key =>
        /^MOSS_(MODEL_)?(BASE_URL|AUTH_TOKEN)$/.test(key) ||
        key === 'MOSS_SERVER_URL' ||
        key === 'MOSS_SERVER_AUTH_TOKEN',
      ),
    ).toBe(false)
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
