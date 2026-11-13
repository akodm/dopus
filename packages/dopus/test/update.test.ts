import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTemplate } from '../src/init/templates.js'
import { unifiedDiff } from '../src/update/diff.js'
import { templateHash, templateHistory } from '../src/update/history.js'
import { type Choice, runUpdate, type UpdateIO } from '../src/update/run.js'
import { nextApp } from './fixture.js'

const UI_DEPS = { '@ai-sdk/react': '^4', 'react-markdown': '^10', 'remark-gfm': '^4' }
const CHAT = 'components/agent/agent-chat.tsx'
const CSS = 'components/agent/agent-chat.css'
const ROUTE = 'app/api/agent/route.ts'
const PRESET = 'agent/prompts/preset.ts'
// The ~600-line chat template of dopus 0.2.14 (before the shell moved into `dopus/react`).
const CHAT_0_2_14 = readFileSync(
  join(import.meta.dirname, 'fixtures', 'agent-chat-0.2.14.tsx'),
  'utf8',
)

// The route `dopus init` 0.1.0–0.2.3 generated (no time budget), with a project-specific config path.
const ROUTE_0_2_0 = `import { createAgentHandler } from 'dopus'
import agent from '@/agent.config'

// Agent replies stream for a while; raise this if your platform cuts requests short.
export const maxDuration = 60

export const POST = createAgentHandler(agent)
`

function project(files: Record<string, string>, deps: Record<string, string> = UI_DEPS) {
  return nextApp({ deps, files })
}

function updateIO(choices: Choice[] = []) {
  const log: string[] = []
  const calls = { choose: [] as string[], install: [] as string[][], diffs: [] as string[] }
  const io: UpdateIO = {
    async choose(message) {
      calls.choose.push(message)
      return choices.shift() ?? 'skip'
    },
    diff: (text) => calls.diffs.push(text),
    async confirm() {
      return true
    },
    info: (m) => log.push(`info: ${m}`),
    warn: (m) => log.push(`warn: ${m}`),
    success: (m) => log.push(`success: ${m}`),
    async install(_pm, packages) {
      calls.install.push(packages)
    },
  }
  return { io, log, calls }
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')
const status = (result: Awaited<ReturnType<typeof runUpdate>>, file: string) =>
  result.files.find((f) => f.file === file)?.status

describe('template history', () => {
  it('has every current template, so the next release can recognise untouched copies', () => {
    const history = templateHistory()
    const keys = [
      'ui/agent-chat.tsx',
      'ui/agent-chat.css',
      'prompts/presets/general.ts',
      'prompts/presets/customer-support.ts',
      'prompts/presets/internal-ops.ts',
    ]
    for (const key of keys) {
      expect(
        history[key]?.[templateHash(readTemplate(key))],
        `${key} changed: run pnpm templates:history`,
      ).toBeDefined()
    }
  })
})

describe('runUpdate', () => {
  it('replaces untouched copies of an older version and keeps the config import path', async () => {
    const root = project({
      [CHAT]: readTemplate('ui/agent-chat.tsx'),
      [CSS]: readTemplate('ui/agent-chat.css'),
      [ROUTE]: ROUTE_0_2_0,
      [PRESET]: readTemplate('prompts/presets/general.ts'),
    })
    const { io, calls } = updateIO()
    const result = await runUpdate({ cwd: root }, io)
    expect(result.files.find((f) => f.file === ROUTE)).toMatchObject({
      status: 'updated',
      from: '0.1.0',
    })
    expect(read(root, ROUTE)).toContain("import agent from '@/agent.config'")
    expect(read(root, ROUTE)).toContain('createAgentHandler(agent, { maxDuration })')
    expect(status(result, CHAT)).toBe('up-to-date')
    expect(status(result, CSS)).toBe('up-to-date')
    expect(status(result, PRESET)).toBe('up-to-date')
    expect(calls.choose).toEqual([])
    expect(calls.install).toEqual([])
  })

  it('asks about an edited file; can show the diff, then keep it', async () => {
    const edited = readTemplate('ui/agent-chat.tsx').replace(
      'toolLog(), approvals()',
      'approvals()',
    )
    const root = project({ [CHAT]: edited, [CSS]: readTemplate('ui/agent-chat.css') })
    const { io, calls } = updateIO(['diff', 'skip'])
    const result = await runUpdate({ cwd: root }, io)
    expect(status(result, CHAT)).toBe('kept')
    expect(calls.choose).toHaveLength(2)
    expect(calls.diffs[0]).toContain('-const plugins = [approvals()]')
    expect(calls.diffs[0]).toContain('+const plugins = [toolLog(), approvals()]')
    expect(read(root, CHAT)).toBe(edited)
  })

  it('with --yes, saves the new template next to an edited file; --force replaces it', async () => {
    const edited = `${readTemplate('ui/agent-chat.tsx')}\n// mine\n`
    const root = project({ [CHAT]: edited, [CSS]: readTemplate('ui/agent-chat.css') })
    const yes = await runUpdate({ cwd: root, yes: true }, updateIO().io)
    expect(status(yes, CHAT)).toBe('saved-new')
    expect(read(root, CHAT)).toBe(edited)
    expect(read(root, `${CHAT}.new`)).toBe(readTemplate('ui/agent-chat.tsx'))

    const forced = await runUpdate({ cwd: root, force: true }, updateIO().io)
    expect(status(forced, CHAT)).toBe('overwritten')
    expect(read(root, CHAT)).toBe(readTemplate('ui/agent-chat.tsx'))
  })

  it('replaces an untouched 0.2.14 chat file with the thin wrapper', async () => {
    const root = project({ [CHAT]: CHAT_0_2_14, [CSS]: readTemplate('ui/agent-chat.css') })
    const { io, calls } = updateIO()
    const result = await runUpdate({ cwd: root }, io)
    expect(result.files.find((f) => f.file === CHAT)).toMatchObject({
      status: 'updated',
      from: '0.2.14',
    })
    expect(read(root, CHAT)).toBe(readTemplate('ui/agent-chat.tsx'))
    expect(read(root, CHAT)).toContain("from 'dopus/react'")
    expect(calls.choose).toEqual([])
  })

  it('keeps an edited 0.2.14 chat file and writes the thin wrapper next to it with --yes', async () => {
    const edited = `${CHAT_0_2_14}\n// mine\n`
    const root = project({ [CHAT]: edited, [CSS]: readTemplate('ui/agent-chat.css') })
    const result = await runUpdate({ cwd: root, yes: true }, updateIO().io)
    expect(status(result, CHAT)).toBe('saved-new')
    expect(read(root, CHAT)).toBe(edited)
    expect(read(root, `${CHAT}.new`)).toBe(readTemplate('ui/agent-chat.tsx'))
  })

  it('compares an edited preset with the preset it came from', async () => {
    const preset = `${readTemplate('prompts/presets/internal-ops.ts')}\n// our wording\n`
    const root = project({ [PRESET]: preset })
    await runUpdate({ cwd: root, yes: true }, updateIO().io)
    expect(read(root, `${PRESET}.new`)).toBe(readTemplate('prompts/presets/internal-ops.ts'))
  })

  it('--dry-run writes nothing', async () => {
    const files = {
      [CHAT]: `${readTemplate('ui/agent-chat.tsx')}// mine\n`,
      [ROUTE]: ROUTE_0_2_0,
    }
    const root = project(files, {})
    const { io, calls } = updateIO()
    const result = await runUpdate({ cwd: root, dryRun: true }, io)
    expect(status(result, CHAT)).toBe('modified')
    expect(status(result, ROUTE)).toBe('updated')
    expect(status(result, CSS)).toBe('created')
    expect(read(root, ROUTE)).toBe(ROUTE_0_2_0)
    expect(existsSync(join(root, CSS))).toBe(false)
    expect(calls.choose).toEqual([])
    expect(calls.install).toEqual([])
    expect(result.missingDependencies).toEqual([
      '@ai-sdk/react@^4',
      'react-markdown@^10',
      'remark-gfm@^4',
    ])
  })

  it('creates the stylesheet the chat UI imports and installs its missing dependencies', async () => {
    const root = project({ [CHAT]: readTemplate('ui/agent-chat.tsx') }, { '@ai-sdk/react': '^4' })
    const { io, calls } = updateIO()
    const result = await runUpdate({ cwd: root, yes: true }, io)
    expect(status(result, CSS)).toBe('created')
    expect(read(root, CSS)).toBe(readTemplate('ui/agent-chat.css'))
    expect(calls.install).toEqual([['react-markdown@^10', 'remark-gfm@^4']])
    expect(status(result, ROUTE)).toBe('missing')
  })

  it('never touches agent.config.ts or app.ts', async () => {
    const root = project({
      'agent.config.ts': 'old',
      'agent/prompts/app.ts': 'old',
      [ROUTE]: ROUTE_0_2_0,
    })
    await runUpdate({ cwd: root, force: true }, updateIO().io)
    expect(read(root, 'agent.config.ts')).toBe('old')
    expect(read(root, 'agent/prompts/app.ts')).toBe('old')
  })
})

describe('unifiedDiff', () => {
  it('shows changed lines with context', () => {
    const diff = unifiedDiff('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nd\nE\nf\ng\nh')
    expect(diff.split('\n')).toEqual(['@@', ' b', ' c', ' d', '-e', '+E', ' f', ' g', ' h'])
    expect(unifiedDiff('same', 'same')).toBe('')
  })
})
