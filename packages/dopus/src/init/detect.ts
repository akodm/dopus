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
  }
}
