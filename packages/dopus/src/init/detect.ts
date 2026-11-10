import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

export function detectPackageManager(root: string, declared?: string): PackageManager {
  const fromField = declared?.split('@')[0]
  if (fromField === 'pnpm' || fromField === 'npm' || fromField === 'yarn' || fromField === 'bun') {
    return fromField
  }
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun'
  return 'npm'
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
