import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { PROVIDERS, type ProviderId, type ProviderInfo } from '../providers.js'
import { detectProject, InitError, type PackageManager } from './detect.js'
import { findDefinitions, isEnvLocalIgnored, upsertEnv } from './env.js'
import { agentConfigTemplate, routeTemplate } from './templates.js'

export const APPROVAL_SECRET_ENV = 'DOPUS_APPROVAL_SECRET'

export interface InitOptions {
  cwd: string
  provider?: ProviderId
  model?: string
  /** Non-interactive: accept defaults, never prompt. */
  yes?: boolean
  /** Install missing dependencies. Default true. */
  install?: boolean
  /** Overwrite generated files that already exist. */
  force?: boolean
}

export interface InitIO {
  selectProvider(): Promise<ProviderId>
  /** Returns the key, or undefined to skip. The value must never be logged. */
  askApiKey(provider: ProviderInfo): Promise<string | undefined>
  confirm(message: string, initial: boolean): Promise<boolean>
  info(message: string): void
  warn(message: string): void
  success(message: string): void
  install(packageManager: PackageManager, packages: string[], cwd: string): Promise<void>
}

export interface InitResult {
  provider: ProviderId
  created: string[]
  skipped: string[]
  overwritten: string[]
  envChanged: string[]
  installed: string[]
  apiKeyMissing: boolean
}

const ADD_COMMAND: Record<PackageManager, string[]> = {
  pnpm: ['add'],
  npm: ['install'],
  yarn: ['add'],
  bun: ['add'],
}

export function installArgs(packageManager: PackageManager, packages: string[]) {
  return [...ADD_COMMAND[packageManager], ...packages]
}

function toImportPath(fromFile: string, toFileWithoutExt: string) {
  const path = relative(dirname(fromFile), toFileWithoutExt).split('\\').join('/')
  return path.startsWith('.') ? path : `./${path}`
}

export async function runInit(options: InitOptions, io: InitIO): Promise<InitResult> {
  const project = detectProject(options.cwd)
  const { root } = project
  const ask = async (message: string, initial: boolean) =>
    options.yes ? initial : io.confirm(message, initial)

  if (options.provider && !(options.provider in PROVIDERS)) {
    throw new InitError(
      `Unknown provider "${options.provider}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`,
    )
  }
  if (options.yes && !options.provider) {
    throw new InitError('--yes needs --provider (openai, anthropic or google).')
  }
  const provider = options.provider ?? (await io.selectProvider())
  const info = PROVIDERS[provider]
  const model = options.model ?? info.defaultModel

  const result: InitResult = {
    provider,
    created: [],
    skipped: [],
    overwritten: [],
    envChanged: [],
    installed: [],
    apiKeyMissing: false,
  }

  // 1. Environment (.env.local only — .env is often committed)
  const envVars: Record<string, string> = {}
  const replace: string[] = []
  const keyDefinedIn = findDefinitions(root, info.envVar)
  if (keyDefinedIn.length > 0) {
    io.info(`${info.envVar} is already set in ${keyDefinedIn.join(', ')}.`)
    if (keyDefinedIn.includes('.env.local')) {
      if (await ask(`Replace ${info.envVar} in .env.local?`, false)) {
        const key = await io.askApiKey(info)
        if (key) {
          envVars[info.envVar] = key
          replace.push(info.envVar)
        }
      }
    }
  } else {
    const key = options.yes ? undefined : await io.askApiKey(info)
    if (key) envVars[info.envVar] = key
    else result.apiKeyMissing = true
  }
  if (findDefinitions(root, APPROVAL_SECRET_ENV).length === 0) {
    envVars[APPROVAL_SECRET_ENV] = randomBytes(32).toString('base64url')
  }

  if (Object.keys(envVars).length > 0) {
    const envPath = join(root, '.env.local')
    const existed = existsSync(envPath)
    const { content, changed } = upsertEnv(
      existed ? readFileSync(envPath, 'utf8') : '',
      envVars,
      replace,
    )
    if (changed.length > 0) {
      writeFileSync(envPath, content, existed ? undefined : { mode: 0o600 })
      result.envChanged = changed
      io.success(`.env.local: set ${changed.join(', ')}`)
    }
  }
  if (!isEnvLocalIgnored(root)) {
    const gitignore = join(root, '.gitignore')
    const prefix =
      existsSync(gitignore) && !readFileSync(gitignore, 'utf8').endsWith('\n') ? '\n' : ''
    appendFileSync(gitignore, `${prefix}\n# local env files (dopus)\n.env*.local\n`)
    io.warn('.env.local was not git-ignored. Added `.env*.local` to .gitignore.')
  }

  // 2. Generated files
  const configFile = join(project.configDir, 'agent.config.ts')
  const routeFile = join(project.appDir, 'api', 'agent', 'route.ts')
  const files: [string, string, string[]][] = [
    [configFile, agentConfigTemplate(provider, model), ['agent.config.js', 'agent.config.mjs']],
    [
      routeFile,
      routeTemplate(toImportPath(routeFile, join(project.configDir, 'agent.config'))),
      [join(project.appDir, 'api', 'agent', 'route.js')],
    ],
  ]
  for (const [file, content, alternatives] of files) {
    const existing = [
      file,
      ...alternatives.map((alt) => (alt.includes('/') ? alt : join(project.configDir, alt))),
    ].find((f) => existsSync(join(root, f)))
    if (existing) {
      const overwrite =
        options.force &&
        existing === file &&
        (await ask(`Overwrite ${file}? Your changes will be lost.`, true))
      if (!overwrite) {
        result.skipped.push(existing)
        io.info(`${existing} exists — left unchanged.`)
        continue
      }
      result.overwritten.push(file)
    } else {
      result.created.push(file)
    }
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
    io.success(`${result.overwritten.includes(file) ? 'Overwrote' : 'Created'} ${file}`)
  }

  // 3. Dependencies
  const wanted: [string, string][] = [
    ['dopus', 'dopus'],
    ['ai', 'ai@^7'],
    ['zod', 'zod@^4'],
    [info.packageName, `${info.packageName}@^4`],
  ]
  const missing = wanted.filter(([name]) => !project.dependencies[name]).map(([, spec]) => spec)
  if (missing.length > 0) {
    if (options.install === false) {
      io.warn(
        `Install these yourself: ${project.packageManager} ${installArgs(project.packageManager, missing).join(' ')}`,
      )
    } else if (await ask(`Install ${missing.join(', ')} with ${project.packageManager}?`, true)) {
      await io.install(project.packageManager, missing, root)
      result.installed = missing
    }
  }

  return result
}
