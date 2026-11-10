import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectPackageManager, detectProject } from '../src/init/detect.js'
import { parseEnvKeys } from '../src/init/env.js'
import { runInit } from '../src/init/run.js'
import { fakeIO, nextApp } from './fixture.js'

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

const GENERATED = [
  'agent.config.ts',
  'agent/prompts/preset.ts',
  'agent/prompts/app.ts',
  'app/api/agent/route.ts',
  'components/agent/agent-chat.tsx',
  'components/agent/agent-chat.module.css',
]

describe('detectProject', () => {
  it('finds app/ or src/app/ and the package manager', () => {
    expect(detectProject(nextApp())).toMatchObject({
      appDir: 'app',
      configDir: '.',
      packageManager: 'pnpm',
    })
    expect(detectProject(nextApp({ srcDir: true }))).toMatchObject({
      appDir: 'src/app',
      configDir: 'src',
    })
  })

  it('explains what is wrong with a non-Next project', () => {
    const root = nextApp()
    writeFileSync(join(root, 'package.json'), '{"dependencies":{}}')
    expect(() => detectProject(root)).toThrow(/Next\.js/)
  })

  it('prefers the packageManager field over lockfiles', () => {
    expect(detectPackageManager(nextApp(), 'yarn@4.1.0')).toBe('yarn')
  })

  it('finds the lockfile of an enclosing monorepo', () => {
    const repo = nextApp()
    mkdirSync(join(repo, '.git'))
    const app = join(repo, 'apps', 'web')
    mkdirSync(join(app, 'app'), { recursive: true })
    writeFileSync(join(app, 'package.json'), '{"dependencies":{"next":"16.4.6"}}')
    writeFileSync(join(app, 'tsconfig.json'), '{}')
    expect(detectProject(app).packageManager).toBe('pnpm')
  })
})

describe('runInit', () => {
  it('sets up a fresh app', async () => {
    const root = nextApp()
    const { io, calls } = fakeIO({
      provider: 'openai',
      preset: 'customer-support',
      apiKey: 'sk-test-123',
    })
    const result = await runInit({ cwd: root }, io)

    expect(result.created).toEqual(GENERATED)
    expect(read(root, 'agent/prompts/preset.ts')).toContain('support assistant')
    expect(read(root, 'agent/prompts/app.ts')).toContain('export const locales')
    expect(read(root, 'components/agent/agent-chat.tsx')).toContain('export function AgentWidget')
    expect(read(root, 'agent.config.ts')).toContain("import preset from './agent/prompts/preset'")
    expect(result.widgetImport).toBe('../components/agent/agent-chat')
    expect(read(root, 'agent.config.ts')).toContain("import { openai } from '@ai-sdk/openai'")
    expect(read(root, 'agent.config.ts')).toContain("model: openai('gpt-5.5')")
    expect(read(root, 'app/api/agent/route.ts')).toContain(
      "import agent from '../../../agent.config'",
    )

    const env = parseEnvKeys(read(root, '.env.local'))
    expect(env.get('OPENAI_API_KEY')).toBe('sk-test-123')
    expect(env.get('DOPUS_APPROVAL_SECRET')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(statSync(join(root, '.env.local')).mode & 0o777).toBe(0o600)
    expect(existsSync(join(root, '.env'))).toBe(false)
    expect(read(root, '.gitignore')).toContain('.env*.local')

    expect(calls.install).toEqual([
      ['dopus', 'ai@^7', 'zod@^4', '@ai-sdk/openai@^4', '@ai-sdk/react@^4'],
    ])
  })

  it('is safe to run again', async () => {
    const root = nextApp()
    await runInit({ cwd: root }, fakeIO({ apiKey: 'sk-1' }).io)
    const envBefore = read(root, '.env.local')
    const configBefore = read(root, 'agent.config.ts')
    writeFileSync(join(root, 'agent.config.ts'), `${configBefore}// my edits\n`)

    const second = fakeIO({ apiKey: 'sk-2', confirm: false })
    const result = await runInit({ cwd: root }, second.io)

    expect(result.created).toEqual([])
    expect(result.skipped).toEqual(GENERATED)
    expect(second.calls.selectPreset).toBe(1)
    expect(result.envChanged).toEqual([])
    expect(read(root, '.env.local')).toBe(envBefore)
    expect(read(root, 'agent.config.ts')).toContain('// my edits')
    expect(second.calls.askApiKey).toBe(0)
    expect(second.calls.confirm).toEqual([
      'Replace ANTHROPIC_API_KEY in .env.local?',
      expect.stringMatching(/^Install/),
    ])
    expect(read(root, '.gitignore').match(/\.env\*\.local/g)).toHaveLength(1)
  })

  it('does not ask for a key that is already set in another env file', async () => {
    const root = nextApp({ files: { '.env': 'GOOGLE_GENERATIVE_AI_API_KEY=abc\n' } })
    const { io, calls, log } = fakeIO({ provider: 'google' })
    const result = await runInit({ cwd: root }, io)
    expect(calls.askApiKey).toBe(0)
    expect(result.apiKeyMissing).toBe(false)
    expect(log).toContain('info: GOOGLE_GENERATIVE_AI_API_KEY is already set in .env.')
    expect(read(root, '.env')).toBe('GOOGLE_GENERATIVE_AI_API_KEY=abc\n')
    expect(parseEnvKeys(read(root, '.env.local')).has('GOOGLE_GENERATIVE_AI_API_KEY')).toBe(false)
  })

  it('supports src/app and keeps an existing route of the user', async () => {
    const root = nextApp({
      srcDir: true,
      files: { 'src/app/api/agent/route.js': 'export const POST = () => {}' },
    })
    const result = await runInit(
      { cwd: root, provider: 'anthropic', yes: true, install: false },
      fakeIO().io,
    )
    expect(result.created).toEqual([
      'src/agent.config.ts',
      'src/agent/prompts/preset.ts',
      'src/agent/prompts/app.ts',
      'src/components/agent/agent-chat.tsx',
      'src/components/agent/agent-chat.module.css',
    ])
    expect(result.skipped).toEqual(['src/app/api/agent/route.js'])
    expect(result.widgetImport).toBe('../components/agent/agent-chat')
    expect(result.apiKeyMissing).toBe(true)
  })

  it('computes the config import for src/app', async () => {
    const root = nextApp({ srcDir: true })
    await runInit({ cwd: root, provider: 'anthropic', yes: true, install: false }, fakeIO().io)
    expect(read(root, 'src/app/api/agent/route.ts')).toContain(
      "import agent from '../../../agent.config'",
    )
  })

  it('overwrites with --force, and skips deps that are installed', async () => {
    const root = nextApp({ deps: { dopus: '0.1.0', ai: '7.0.0', zod: '4.0.0' } })
    await runInit({ cwd: root, provider: 'anthropic', yes: true, install: false }, fakeIO().io)
    writeFileSync(join(root, 'agent.config.ts'), 'old')
    const { io, calls } = fakeIO()
    const result = await runInit({ cwd: root, provider: 'anthropic', yes: true, force: true }, io)
    expect(result.overwritten).toEqual(GENERATED)
    expect(read(root, 'agent.config.ts')).toContain('defineAgent')
    expect(calls.install).toEqual([['@ai-sdk/anthropic@^4', '@ai-sdk/react@^4']])
    expect(read(root, 'agent/prompts/preset.ts')).toContain('in-app assistant')
  })

  it('rejects an unknown preset', async () => {
    await expect(
      runInit(
        { cwd: nextApp(), provider: 'openai', preset: 'nope' as never, yes: true },
        fakeIO().io,
      ),
    ).rejects.toThrow(/preset/)
  })

  it('requires --provider with --yes', async () => {
    await expect(runInit({ cwd: nextApp(), yes: true }, fakeIO().io)).rejects.toThrow(/--provider/)
  })
})
