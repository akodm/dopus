import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Files Next.js loads in development, in the order it gives them precedence. */
export const ENV_FILES = [
  '.env.development.local',
  '.env.local',
  '.env.development',
  '.env',
] as const

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?$/

export function parseEnvKeys(content: string): Map<string, string> {
  const keys = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const match = LINE.exec(line)
    if (match?.[1]) keys.set(match[1], (match[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2'))
  }
  return keys
}

/** Which env files already define `key` with a non-empty value. Values are never returned. */
export function findDefinitions(root: string, key: string): string[] {
  return ENV_FILES.filter((file) => {
    const path = join(root, file)
    return existsSync(path) && Boolean(parseEnvKeys(readFileSync(path, 'utf8')).get(key))
  })
}

function quote(value: string) {
  return /^[A-Za-z0-9_\-.:/+=]*$/.test(value) ? value : JSON.stringify(value)
}

/**
 * Sets `vars` in dotenv content. Existing non-empty values are kept unless `replace` lists the key;
 * empty placeholders (`KEY=`) are filled in place. New keys are appended under a `# dopus` header.
 */
export function upsertEnv(content: string, vars: Record<string, string>, replace: string[] = []) {
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  const pending = new Map(Object.entries(vars))
  const changed: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const match = LINE.exec(lines[i] ?? '')
    const key = match?.[1]
    if (!key || !pending.has(key)) continue
    const current = (match?.[2] ?? '').trim()
    if (current === '' || replace.includes(key)) {
      lines[i] = `${key}=${quote(pending.get(key) ?? '')}`
      changed.push(key)
    }
    pending.delete(key)
  }

  if (pending.size > 0) {
    if (lines.length > 0 && lines.at(-1) !== '') lines.push('')
    lines.push('# dopus')
    for (const [key, value] of pending) {
      lines.push(`${key}=${quote(value)}`)
      changed.push(key)
    }
  }
  return { content: `${lines.join('\n')}\n`, changed }
}

/** True if git (or, without git, .gitignore patterns) keeps `.env.local` out of the repo. */
export function isEnvLocalIgnored(root: string): boolean {
  return isGitIgnored(root, '.env.local', [
    '.env.local',
    '.env*.local',
    '.env*',
    '*.local',
    '.env.*',
  ])
}

/** True if git ignores `path`; outside a repo, falls back to exact lines in .gitignore. */
export function isGitIgnored(
  root: string,
  path: string,
  patterns: string[] = [path, `${path}/`, `/${path}`],
): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'ignore' })
    return true
  } catch (error) {
    // exit 1 = not ignored; anything else (no git, not a repo) → fall back to reading .gitignore
    if ((error as { status?: number }).status === 1) return false
  }
  const gitignore = join(root, '.gitignore')
  if (!existsSync(gitignore)) return false
  const lines = readFileSync(gitignore, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
  return lines.some((line) => patterns.includes(line))
}
