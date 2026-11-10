import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runInfraAws, sstSnippet } from '../src/infra/aws.js'
import { installArgs, runInit } from '../src/init/run.js'
import { PROVIDERS } from '../src/providers.js'
import { fakeIO, nextApp } from './fixture.js'

function infraIO() {
  const { io, calls, log } = fakeIO()
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
    calls,
    log,
    notes,
    installs,
  }
}

describe('dopus infra aws', () => {
  it('writes a streaming open-next config and names the configured provider key', async () => {
    const root = nextApp()
    await runInit({ cwd: root, provider: 'google', yes: true, install: false }, fakeIO().io)
    const { io, notes, installs } = infraIO()
    const result = await runInfraAws({ cwd: root, yes: true }, io)

    expect(result).toMatchObject({ created: true, streaming: true, provider: PROVIDERS.google })
    expect(readFileSync(join(root, 'open-next.config.ts'), 'utf8')).toContain(
      "wrapper: 'aws-lambda-streaming'",
    )
    expect(installs).toEqual([{ packages: ['@opennextjs/aws@^4'], dev: true }])
    expect(notes[0]).toContain('GOOGLE_GENERATIVE_AI_API_KEY: googleGenerativeAiApiKey.value')
    expect(notes[0]).toContain('DOPUS_APPROVAL_SECRET: dopusApprovalSecret.value')
  })

  it('leaves an existing open-next config alone and says what is missing', async () => {
    const root = nextApp({ files: { 'open-next.config.ts': 'export default { default: {} }\n' } })
    const { io, log } = infraIO()
    const result = await runInfraAws({ cwd: root, install: false }, io)
    expect(result).toMatchObject({ created: false, streaming: false })
    expect(readFileSync(join(root, 'open-next.config.ts'), 'utf8')).toBe(
      'export default { default: {} }\n',
    )
    expect(log.some((line) => line.includes("wrapper: 'aws-lambda-streaming'"))).toBe(true)
  })

  it('recognises a config that already streams and an installed OpenNext', async () => {
    const root = nextApp({ deps: { '@opennextjs/aws': '4.1.15' } })
    writeFileSync(join(root, 'open-next.config.ts'), "// wrapper: 'aws-lambda-streaming'\n")
    const { io, installs } = infraIO()
    expect(await runInfraAws({ cwd: root, yes: true }, io)).toMatchObject({
      streaming: true,
      created: false,
    })
    expect(installs).toEqual([])
  })

  it('adds -D for dev installs', () => {
    expect(installArgs('pnpm', ['x'], true)).toEqual(['add', '-D', 'x'])
    expect(installArgs('npm', ['x'], true)).toEqual(['install', '-D', 'x'])
  })

  it('falls back to OpenAI in the snippet when the provider is unknown', () => {
    expect(sstSnippet(undefined)).toContain('OPENAI_API_KEY')
  })
})
