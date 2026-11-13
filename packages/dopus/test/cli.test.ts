import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

  it('prints help for a subcommand --help', () => {
    for (const args of [
      ['init', '--help'],
      ['infra', 'aws', '-h'],
    ]) {
      const run = spawnSync('node', [cli, ...args], { encoding: 'utf8' })
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('dopus init [options]')
    }
  })

  it('update says how to move an edited 0.2.x chat file to the package UI', () => {
    const old = readFileSync(join(import.meta.dirname, 'fixtures', 'agent-chat-0.2.14.tsx'), 'utf8')
    const root = nextApp({ files: { 'components/agent/agent-chat.tsx': `${old}\n// mine\n` } })
    const run = spawnSync('node', [cli, 'update', '--yes', '--no-install', '--cwd', root], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(existsSync(join(root, 'components/agent/agent-chat.tsx.new'))).toBe(true)
    expect(run.stdout).toContain('old self-contained chat UI')
    expect(run.stdout).toContain('replace it with agent-chat.tsx.new')
    expect(run.stdout).toContain('Upgrading from 0.2')
    expect(run.stdout).not.toContain('Merge each')
  })

  it('rejects unknown commands', () => {
    expect(spawnSync('node', [cli, 'nope'], { encoding: 'utf8' }).status).toBe(1)
  })
})
