#!/usr/bin/env node
// Packs dopus and installs the tarball into a fresh create-next-app project (its defaults: Tailwind via the
// Turbopack loader, cacheComponents, ESLint), runs `dopus init`, lints, builds, then serves the page and checks
// that the chat widget is rendered with its styles. Catches publishing mistakes and template breakage in the
// setup most users start from.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NEXT_VERSION = '16.4.6'
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
run('pnpm', ['add', join(work, tarball)], app)
run(
  join(app, 'node_modules', '.bin', 'dopus'),
  ['init', '--provider', 'openai', '--preset', 'general', '--yes'],
  app,
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
