import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compatibilityDate, runInfraCloudflare, workerName } from '../src/infra/cloudflare.js'
import { parseEnvKeys } from '../src/init/env.js'
import { runInit } from '../src/init/run.js'
import { fakeIO, nextApp } from './fixture.js'

function infraIO() {
  const { io, log } = fakeIO()
  const notes: string[] = []
  const installs: { packages: string[]; dev?: boolean }[] = []
  return {
    io: {
      ...io,
      note: (message: string, title: string) => notes.push(`${title}\n${message}`),
      install: async (_pm: string, packages: string[], _cwd: string, dev?: boolean) => {
        installs.push({ packages, dev })
      },
    },
    log,
    notes,
    installs,
  }
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

describe('dopus infra cloudflare', () => {
  it('writes the OpenNext Cloudflare setup without touching the user’s scripts', async () => {
    const root = nextApp()
    const pkg = JSON.parse(read(root, 'package.json'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ ...pkg, name: '@acme/Shop App', scripts: { dev: 'next dev' } }),
    )
    await runInit({ cwd: root, provider: 'anthropic', yes: true, install: false }, fakeIO().io)

    const { io, notes, installs } = infraIO()
    const result = await runInfraCloudflare({ cwd: root, yes: true }, io)

    expect(result.created).toEqual(['open-next.config.ts', 'wrangler.jsonc', '.dev.vars'])
    expect(read(root, 'open-next.config.ts')).toContain('defineCloudflareConfig')
    const wrangler = read(root, 'wrangler.jsonc')
    expect(wrangler).toContain('"name": "shop-app"')
    expect(wrangler).toContain('"service": "shop-app"')
    expect(wrangler).toContain('"nodejs_compat"')
    expect(statSync(join(root, '.dev.vars')).mode & 0o777).toBe(0o600)
    expect(result.created).toContain('.dev.vars')

    const scripts = JSON.parse(read(root, 'package.json')).scripts
    expect(scripts).toEqual({
      dev: 'next dev',
      'cf:preview': 'opennextjs-cloudflare build && opennextjs-cloudflare preview',
      'cf:deploy': 'opennextjs-cloudflare build && opennextjs-cloudflare deploy',
    })
    expect(read(root, '.gitignore')).toMatch(/\.open-next\n\.dev\.vars\n\.wrangler\n/)
    expect(installs).toEqual([
      { packages: ['@opennextjs/cloudflare@^1'], dev: false },
      { packages: ['wrangler@^4'], dev: true },
    ])
    expect(notes[0]).toContain('wrangler secret put ANTHROPIC_API_KEY')
    expect(notes[0]).toContain('wrangler secret put DOPUS_APPROVAL_SECRET')
  })

  it('copies the API key and approval secret into .dev.vars for wrangler', async () => {
    const root = nextApp({ files: { '.env.local': 'ANTHROPIC_API_KEY=sk-ant-test\nOTHER=x\n' } })
    await runInit({ cwd: root, provider: 'anthropic', yes: true, install: false }, fakeIO().io)
    await runInfraCloudflare({ cwd: root, yes: true, install: false }, infraIO().io)
    const devVars = parseEnvKeys(read(root, '.dev.vars'))
    expect(devVars.get('NEXTJS_ENV')).toBe('development')
    expect(devVars.get('ANTHROPIC_API_KEY')).toBe('sk-ant-test')
    expect(devVars.get('DOPUS_APPROVAL_SECRET')).toBe(
      parseEnvKeys(read(root, '.env.local')).get('DOPUS_APPROVAL_SECRET'),
    )
    expect(devVars.has('OTHER')).toBe(false)
  })

  it('does not copy secrets when declined', async () => {
    const root = nextApp({ files: { '.env.local': 'OPENAI_API_KEY=sk-test\n' } })
    const { io } = infraIO()
    await runInfraCloudflare({ cwd: root, install: false }, { ...io, confirm: async () => false })
    expect(parseEnvKeys(read(root, '.dev.vars')).has('OPENAI_API_KEY')).toBe(false)
  })

  it('is safe to run again', async () => {
    const root = nextApp()
    await runInfraCloudflare({ cwd: root, yes: true, install: false }, infraIO().io)
    const before =
      read(root, 'wrangler.jsonc') + read(root, '.gitignore') + read(root, 'package.json')
    const result = await runInfraCloudflare({ cwd: root, yes: true, install: false }, infraIO().io)
    expect(result.created).toEqual([])
    expect(result.scripts).toEqual([])
    expect(
      read(root, 'wrangler.jsonc') + read(root, '.gitignore') + read(root, 'package.json'),
    ).toBe(before)
  })

  it('refuses to overwrite an AWS open-next config', async () => {
    const root = nextApp({
      files: { 'open-next.config.ts': "override: { wrapper: 'aws-lambda-streaming' }" },
    })
    await expect(runInfraCloudflare({ cwd: root, yes: true }, infraIO().io)).rejects.toThrow(
      /another target/,
    )
  })

  it('derives a valid worker name and a past compatibility date', () => {
    expect(workerName('@scope/My_App!')).toBe('my-app')
    expect(workerName(undefined)).toBe('next-app')
    expect(compatibilityDate(new Date('2026-11-10T00:00:00Z'))).toBe('2026-10-11')
  })
})
