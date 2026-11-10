import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InitIO } from '../src/init/run.js'
import type { PresetId } from '../src/init/templates.js'
import type { ProviderId } from '../src/providers.js'

export function nextApp(
  options: { srcDir?: boolean; deps?: Record<string, string>; files?: Record<string, string> } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'dopus-init-'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'app',
      dependencies: { next: '16.4.6', react: '19.3.1', ...options.deps },
    }),
  )
  writeFileSync(join(root, 'tsconfig.json'), '{}')
  writeFileSync(join(root, 'pnpm-lock.yaml'), '')
  mkdirSync(join(root, options.srcDir ? 'src/app' : 'app'), { recursive: true })
  for (const [file, content] of Object.entries(options.files ?? {})) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  return root
}

export function fakeIO(
  answers: { provider?: ProviderId; preset?: PresetId; apiKey?: string; confirm?: boolean } = {},
) {
  const log: string[] = []
  const calls = {
    selectPreset: 0,
    selectProvider: 0,
    askApiKey: 0,
    confirm: [] as string[],
    install: [] as string[][],
  }
  const io: InitIO = {
    async selectProvider() {
      calls.selectProvider++
      return answers.provider ?? 'anthropic'
    },
    async selectPreset() {
      calls.selectPreset++
      return answers.preset ?? 'general'
    },
    async askApiKey() {
      calls.askApiKey++
      return answers.apiKey
    },
    async confirm(message) {
      calls.confirm.push(message)
      return answers.confirm ?? true
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
