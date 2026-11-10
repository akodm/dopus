import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addStandalone, dockerfile, runInfraGcp } from '../src/infra/gcp.js'
import { runInit } from '../src/init/run.js'
import { fakeIO, nextApp } from './fixture.js'

function infraIO(confirm = true) {
  const { io, log } = fakeIO({ confirm })
  const notes: string[] = []
  return { io: { ...io, note: (m: string, t: string) => notes.push(`${t}\n${m}`) }, log, notes }
}
const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

describe('addStandalone', () => {
  it('edits the common next.config shapes', () => {
    expect(addStandalone('const nextConfig: NextConfig = {}\n')).toBe(
      "const nextConfig: NextConfig = {\n  output: 'standalone',\n}\n",
    )
    expect(addStandalone('const nextConfig = {\n  reactStrictMode: true,\n}')).toBe(
      "const nextConfig = {\n  output: 'standalone',\n  reactStrictMode: true,\n}",
    )
    expect(addStandalone('export default {}')).toBe("export default {\n  output: 'standalone',\n}")
  })

  it('leaves standalone configs alone and refuses shapes it cannot edit safely', () => {
    expect(addStandalone("export default { output: 'standalone' }")).toBe(
      "export default { output: 'standalone' }",
    )
    expect(addStandalone("export default { output: 'export' }")).toBeUndefined()
    expect(addStandalone('export default withPlugins(config)')).toBeUndefined()
  })
})

describe('dopus infra gcp', () => {
  it('writes a Dockerfile, a .dockerignore that keeps secrets out, and enables standalone', async () => {
    const root = nextApp({
      files: { 'next.config.ts': 'const nextConfig: NextConfig = {}\nexport default nextConfig\n' },
    })
    await runInit({ cwd: root, provider: 'openai', yes: true, install: false }, fakeIO().io)
    const { io, notes } = infraIO()
    const result = await runInfraGcp({ cwd: root, yes: true }, io)

    expect(result).toEqual({
      created: ['Dockerfile', '.dockerignore'],
      skipped: [],
      standalone: true,
    })
    expect(read(root, 'next.config.ts')).toContain("output: 'standalone'")
    expect(read(root, 'Dockerfile')).toMatch(
      /corepack enable pnpm && corepack prepare pnpm@\d+\.\d+\.\d+ --activate && pnpm install --frozen-lockfile/,
    )
    expect(read(root, '.dockerignore')).toMatch(/^\.env$/m)
    expect(read(root, '.dockerignore')).toMatch(/^\.env\.\*$/m)
    expect(notes[0]).toContain(
      '--set-secrets OPENAI_API_KEY=openai-api-key:latest,DOPUS_APPROVAL_SECRET=dopus-approval-secret:latest',
    )
    expect(notes[0]).toContain('--timeout 3600')
  })

  it('does not change next.config when the user declines, and warns', async () => {
    const root = nextApp({ files: { 'next.config.ts': 'export default {}\n' } })
    const { io, log } = infraIO(false)
    const result = await runInfraGcp({ cwd: root }, io)
    expect(result.standalone).toBe(false)
    expect(read(root, 'next.config.ts')).toBe('export default {}\n')
    expect(log.some((l) => l.includes("output: 'standalone'"))).toBe(true)
  })

  it('keeps an existing Dockerfile and flags a .dockerignore that would ship .env files', async () => {
    const root = nextApp({
      files: {
        Dockerfile: 'FROM scratch\n',
        '.dockerignore': 'node_modules\n',
        'next.config.mjs': "export default { output: 'standalone' }\n",
      },
    })
    const { io, log } = infraIO()
    const result = await runInfraGcp({ cwd: root, yes: true }, io)
    expect(result).toEqual({
      created: [],
      skipped: ['Dockerfile', '.dockerignore'],
      standalone: true,
    })
    expect(read(root, 'Dockerfile')).toBe('FROM scratch\n')
    expect(log.some((l) => l.includes('secrets would end up in the image'))).toBe(true)
  })

  it('uses the right install command per package manager', () => {
    expect(dockerfile('npm')).toContain('COPY package.json package-lock.json ./\nRUN npm ci')
    expect(dockerfile('yarn', '4.5.0')).toContain(
      'corepack prepare yarn@4.5.0 --activate && yarn install --frozen-lockfile',
    )
    expect(dockerfile('pnpm')).toContain(
      'RUN corepack enable pnpm && pnpm install --frozen-lockfile',
    )
    expect(() => dockerfile('bun')).toThrow(/Bun/)
  })

  it('creates a next.config when there is none', async () => {
    const root = nextApp()
    writeFileSync(join(root, 'package-lock.json'), '{}')
    const result = await runInfraGcp({ cwd: root, yes: true }, infraIO().io)
    expect(result.created).toContain('next.config.mjs')
    expect(read(root, 'next.config.mjs')).toContain("output: 'standalone'")
  })
})
