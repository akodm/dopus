#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import * as p from '@clack/prompts'
import { InitError } from './init/detect.js'
import { type InitIO, installArgs, runInit } from './init/run.js'
import { PROVIDERS, type ProviderId } from './providers.js'
import { VERSION } from './version.js'

const HELP = `dopus ${VERSION}

Usage:
  dopus init [options]   Add an AI agent to this Next.js app

Options for init:
  --provider <id>        openai | anthropic | google
  --model <id>           Model id (default depends on the provider)
  -y, --yes              Non-interactive; skips the API key prompt (needs --provider)
  --no-install           Do not install dependencies
  --force                Overwrite generated files that already exist
  --cwd <dir>            Project root (default: current directory)

  -h, --help             Show this help
  -v, --version          Show the version
`

function cancelled<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Cancelled. Files written before this step are kept.')
    process.exit(130)
  }
  return value as Exclude<T, symbol>
}

const io: InitIO = {
  async selectProvider() {
    return cancelled(
      await p.select<ProviderId>({
        message: 'Which LLM provider?',
        options: Object.values(PROVIDERS).map((info) => ({ value: info.id, label: info.label })),
      }),
    )
  },
  async askApiKey(info) {
    const key = cancelled(
      await p.password({
        message: `${info.envVar} (saved to .env.local; leave empty to add it later)`,
        mask: '•',
      }),
    )
    return key?.trim() || undefined
  },
  async confirm(message, initial) {
    return cancelled(await p.confirm({ message, initialValue: initial }))
  },
  info: (message) => p.log.info(message),
  warn: (message) => p.log.warn(message),
  success: (message) => p.log.success(message),
  install(packageManager, packages, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn(packageManager, installArgs(packageManager, packages), {
        cwd,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      })
      child.on('error', reject)
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new InitError(`${packageManager} exited with code ${code}`)),
      )
    })
  },
}

async function init(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      provider: { type: 'string' },
      model: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      install: { type: 'boolean', default: true },
      'no-install': { type: 'boolean' },
      force: { type: 'boolean' },
      cwd: { type: 'string' },
    },
    allowNegative: true,
  })

  p.intro(`dopus ${VERSION}`)
  const result = await runInit(
    {
      cwd: values.cwd ?? process.cwd(),
      provider: values.provider as ProviderId | undefined,
      model: values.model,
      yes: values.yes,
      install: values['no-install'] ? false : values.install,
      force: values.force,
    },
    io,
  )
  const info = PROVIDERS[result.provider]
  const steps = [
    result.apiKeyMissing ? `Add ${info.envVar}=... to .env.local` : undefined,
    'Register your server functions as tools in agent.config.ts',
    'POST /api/agent is ready for useChat (chat UI templates come with `dopus init` in a later version)',
  ].filter(Boolean)
  p.note(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), 'Next steps')
  p.outro('Done.')
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === '--version' || command === '-v') return console.log(VERSION)
  if (command === 'init') return init(rest)
  console.log(HELP)
  if (command && command !== '--help' && command !== '-h') process.exitCode = 1
}

main().catch((error: unknown) => {
  if (
    error instanceof InitError ||
    (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
  ) {
    p.log.error((error as Error).message)
  } else {
    console.error(error)
  }
  process.exit(1)
})
