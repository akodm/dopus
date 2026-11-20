import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export interface Project {
  root: string
  /** Directory that holds the App Router, relative to root: `app` or `src/app`. */
  appDir: string
  /** Where `agent.config.ts` goes, relative to root: `.` or `src`. */
  configDir: string
  packageManager: PackageManager
  dependencies: Record<string, string>
  nextVersion: string
  /** The tsconfig path alias for `configDir`, e.g. `@/`; generated files import through it when set. */
  alias?: string
}

export class InitError extends Error {
  override name = 'InitError'
}

function readPackageJson(root: string) {
  const file = join(root, 'package.json')
  if (!existsSync(file)) {
    throw new InitError('No package.json here. Run `dopus init` in the root of your Next.js app.')
  }
  return JSON.parse(readFileSync(file, 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    packageManager?: string
  }
}

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]

function fromPackageManagerField(value: unknown): PackageManager | undefined {
  const name = typeof value === 'string' ? value.split('@')[0] : undefined
  return name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun' ? name : undefined
}

/**
 * `packageManager` field or lockfile, searching upward so apps inside a monorepo
 * use the workspace's package manager. Stops at the repository root (.git).
 */
export function detectPackageManager(root: string, declared?: string): PackageManager {
  const own = fromPackageManagerField(declared)
  if (own) return own
  let dir = resolve(root)
  while (true) {
    for (const [file, manager] of LOCKFILES) {
      if (existsSync(join(dir, file))) return manager
    }
    if (dir !== resolve(root) && existsSync(join(dir, 'package.json'))) {
      try {
        const field = fromPackageManagerField(
          JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).packageManager,
        )
        if (field) return field
      } catch {
        // unreadable package.json above the app: ignore
      }
    }
    const parent = dirname(dir)
    if (parent === dir || existsSync(join(dir, '.git'))) return 'npm'
    dir = parent
  }
}

export function detectProject(root: string): Project {
  const pkg = readPackageJson(root)
  const dependencies = { ...pkg.devDependencies, ...pkg.dependencies }
  const nextVersion = dependencies.next
  if (!nextVersion) {
    throw new InitError(
      'This does not look like a Next.js app (no `next` dependency in package.json).',
    )
  }

  const appDir = existsSync(join(root, 'src', 'app'))
    ? 'src/app'
    : existsSync(join(root, 'app'))
      ? 'app'
      : undefined
  if (!appDir) {
    throw new InitError('No `app/` or `src/app/` directory found. dopus needs the App Router.')
  }
  if (!existsSync(join(root, 'tsconfig.json'))) {
    throw new InitError('No tsconfig.json found. dopus generates TypeScript files.')
  }

  return {
    root,
    appDir,
    configDir: appDir === 'src/app' ? 'src' : '.',
    packageManager: detectPackageManager(root, pkg.packageManager),
    dependencies,
    nextVersion,
    alias: findAlias(root, appDir === 'src/app' ? 'src' : '.'),
  }
}

/** JSON with comments and trailing commas, as tsconfig.json allows. */
export function parseJsonc(text: string): unknown {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      const end = /"(?:[^"\\\n]|\\.)*"/y
      end.lastIndex = i
      const match = end.exec(text)
      const literal = match?.[0] ?? c
      out += literal
      i += literal.length
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 2
    } else {
      out += c
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/**
 * The `paths` alias whose target is `configDir` (e.g. `"@/*": ["./*"]`), as its prefix (`@/`). Only this
 * project's own tsconfig.json is read (not `extends`); without a match, generated files use relative imports.
 */
export function findAlias(root: string, configDir: string): string | undefined {
  let options: { baseUrl?: unknown; paths?: unknown } | undefined
  try {
    options = (
      parseJsonc(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
        compilerOptions?: typeof options
      }
    )?.compilerOptions
  } catch {
    return undefined
  }
  if (!options?.paths || typeof options.paths !== 'object') return undefined
  const base = typeof options.baseUrl === 'string' ? options.baseUrl : '.'
  const want = resolve(root, configDir)
  for (const [key, targets] of Object.entries(options.paths)) {
    if (!/^[^*]+\/\*$/.test(key) || !Array.isArray(targets)) continue
    const target = targets[0]
    if (typeof target !== 'string' || !/(^|\/)\*$/.test(target)) continue
    if (resolve(root, base, target.slice(0, -1)) === want) return key.slice(0, -1)
  }
  return undefined
}
