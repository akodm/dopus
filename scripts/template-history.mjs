#!/usr/bin/env node
// Writes packages/dopus/templates/history.json: a hash of every template file each release (and the working tree)
// shipped. `dopus update` uses it to tell an untouched copy (safe to replace) from one the user edited.
// Run after changing a template; a test fails while the current templates are missing from the file.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..')
const pkg = join(repo, 'packages', 'dopus')
const git = (...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const show = (ref, path) => {
  try {
    return git('show', `${ref}:${path}`)
  } catch {
    return undefined
  }
}

// Must match normalize() in src/update/history.ts.
const CONFIG_IMPORT = /^import agent from ['"][^'"]+['"]/m
const normalize = (text) =>
  text.replace(/\r\n/g, '\n').replace(CONFIG_IMPORT, "import agent from '<config>'")
const hash = (text) => createHash('sha256').update(normalize(text)).digest('hex').slice(0, 16)

const FILES = [
  'ui/agent-chat.tsx',
  'ui/agent-chat.css',
  'ui/agent-chat.module.css',
  'prompts/presets/general.ts',
  'prompts/presets/customer-support.ts',
  'prompts/presets/internal-ops.ts',
]

// The route is generated from a string in src/init/templates.ts, not a file.
function routeFrom(source) {
  const match = source?.match(
    /export function routeTemplate\(configImport: string\) \{\n {2}return `([\s\S]*?)`\n\}/,
  )
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder in the template source
  return match?.[1].replace('${configImport}', '<config>')
}

const history = {}
function add(key, text, version) {
  if (text === undefined) return
  history[key] ??= {}
  history[key][hash(text)] ??= version
}

const tags = git('tag', '--list', 'v*', '--sort=version:refname').split('\n').filter(Boolean)
for (const tag of tags) {
  const version = tag.slice(1)
  for (const file of FILES) add(file, show(tag, `packages/dopus/templates/${file}`), version)
  add('route', routeFrom(show(tag, 'packages/dopus/src/init/templates.ts')), version)
}
const current = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
for (const file of FILES) {
  try {
    add(file, readFileSync(join(pkg, 'templates', file), 'utf8'), current)
  } catch {}
}
add('route', routeFrom(readFileSync(join(pkg, 'src', 'init', 'templates.ts'), 'utf8')), current)

writeFileSync(join(pkg, 'templates', 'history.json'), `${JSON.stringify(history, null, 2)}\n`)
console.log(
  Object.entries(history)
    .map(([key, hashes]) => `${key}: ${Object.keys(hashes).length} versions`)
    .join('\n'),
)
