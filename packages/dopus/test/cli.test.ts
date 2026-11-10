import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { nextApp } from './fixture.js'

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js')

describe('dopus CLI (built)', () => {
  beforeAll(() => {
    if (!existsSync(cli)) execFileSync('pnpm', ['build'], { cwd: join(import.meta.dirname, '..') })
  })

  it('runs init non-interactively', () => {
    const root = nextApp()
    const run = spawnSync(
      'node',
      [cli, 'init', '--provider', 'google', '--yes', '--no-install', '--cwd', root],
      {
        encoding: 'utf8',
      },
    )
    expect(run.status).toBe(0)
    expect(existsSync(join(root, 'agent.config.ts'))).toBe(true)
    expect(existsSync(join(root, 'app/api/agent/route.ts'))).toBe(true)
    expect(run.stdout).toContain('GOOGLE_GENERATIVE_AI_API_KEY')
  })

  it('fails with a readable message outside a Next app', () => {
    const run = spawnSync('node', [cli, 'init', '--provider', 'openai', '--yes', '--cwd', '/'], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stdout + run.stderr).toContain('No package.json')
  })

  it('rejects unknown commands', () => {
    expect(spawnSync('node', [cli, 'nope'], { encoding: 'utf8' }).status).toBe(1)
  })
})
