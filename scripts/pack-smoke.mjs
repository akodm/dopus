#!/usr/bin/env node
// Packs dopus and installs the tarball into a fresh create-next-app project (its defaults: Tailwind via the
// Turbopack loader, cacheComponents, ESLint). The app is first set up with an older published dopus, then
// `dopus update` from the tarball must bring the copied files to exactly what a fresh `dopus init` writes.
// Then it lints, builds, serves the page and checks that the chat widget is rendered with its styles.
// Catches publishing mistakes and template breakage in the setup most users start from.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NEXT_VERSION = '16.4.6'
// An earlier release to upgrade from with `dopus update`.
const FROM_VERSION = '0.2.5'
const repo = join(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'dopus-smoke-'))
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

run('pnpm', ['pack', '--pack-destination', work], join(repo, 'packages', 'dopus'))
const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'))

run(
  'npx',
  [
    '-y',
    `create-next-app@${NEXT_VERSION}`,
    'app',
    '--ts',
    '--tailwind',
    '--eslint',
    '--app',
    '--use-pnpm',
    '--import-alias',
    '@/*',
    '--no-agent-feedback',
    '--disable-git',
    '--yes',
  ],
  work,
)
const app = join(work, 'app')
const dopus = (...args) => run(join(app, 'node_modules', '.bin', 'dopus'), args, app)
const initArgs = ['init', '--provider', 'openai', '--preset', 'general', '--yes']
const COPIED = [
  'components/agent/agent-chat.tsx',
  'components/agent/agent-chat.css',
  'app/api/agent/route.ts',
  'agent/prompts/preset.ts',
]
const snapshot = () =>
  Object.fromEntries(COPIED.map((f) => [f, readFileSync(join(app, f), 'utf8')]))

run('pnpm', ['add', `dopus@${FROM_VERSION}`], app)
dopus(...initArgs)
const before = snapshot()
run('pnpm', ['add', join(work, tarball)], app)
dopus('update', '--yes')
const updated = snapshot()
// What a fresh init of this version writes (also leaves agent.config.ts current for the build below).
dopus(...initArgs, '--force')
const fresh = snapshot()
for (const file of COPIED) {
  if (updated[file] !== fresh[file]) {
    throw new Error(`dopus update left ${file} different from a fresh init`)
  }
}
console.log(
  `update ${FROM_VERSION} → tarball: ${COPIED.filter((f) => before[f] !== fresh[f]).length} files changed, all match a fresh init`,
)

// What `dopus init` tells users to do next.
const layoutPath = join(app, 'app', 'layout.tsx')
const layout = readFileSync(layoutPath, 'utf8')
  .replace(/^/, "import { AgentWidget } from '@/components/agent/agent-chat'\n")
  .replace(/\{children\}/, '{children}<AgentWidget />')
writeFileSync(layoutPath, layout)

run(join(app, 'node_modules', '.bin', 'eslint'), ['--max-warnings', '0', '.'], app)
run(join(app, 'node_modules', '.bin', 'next'), ['build'], app)

const port = 3900 + Math.floor(Math.random() * 90)
const server = spawn(join(app, 'node_modules', '.bin', 'next'), ['start', '-p', String(port)], {
  cwd: app,
  stdio: 'ignore',
})
try {
  let html = ''
  for (let i = 0; i < 100 && !html; i++) {
    html = await fetch(`http://127.0.0.1:${port}/`)
      .then((r) => r.text())
      .catch(() => new Promise((r) => setTimeout(() => r(''), 200)))
  }
  if (!html.includes('class="dopus-widget"')) throw new Error('widget markup missing from the page')
  const css = await Promise.all(
    [...html.matchAll(/href="([^"]+\.css)"/g)].map(([, href]) =>
      fetch(`http://127.0.0.1:${port}${href}`).then((r) => r.text()),
    ),
  )
  if (!css.some((sheet) => /\.dopus-widget\s*\{[^}]*position:\s*fixed/.test(sheet))) {
    throw new Error('the page CSS has no .dopus-widget rule; the chat UI would be unstyled')
  }
} finally {
  server.kill()
}
console.log(`\npack-smoke: OK (${work})`)
