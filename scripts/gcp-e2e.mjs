#!/usr/bin/env node
// Copies examples/next-app to a temp dir, runs `dopus infra gcp`, builds the generated Dockerfile, runs the image the way
// Cloud Run does (PORT=8080, secrets as env vars) and runs the example's e2e suite against it. Nothing is deployed.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..')
const example = join(repo, 'examples', 'next-app')
const work = mkdtempSync(join(tmpdir(), 'dopus-gcp-'))
const app = join(work, 'app')
const env = { ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1' }
const run = (cmd, args, cwd, opts = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env, ...opts })

const skip = new Set([
  'node_modules',
  '.next',
  '.open-next',
  '.env.local',
  'next-env.d.ts',
  'tsconfig.tsbuildinfo',
  'open-next.config.ts',
  'test',
  'vitest.config.ts',
])
cpSync(example, app, {
  recursive: true,
  filter: (src) => !skip.has(src.slice(example.length + 1).split('/')[0]),
})
run('pnpm', ['pack', '--pack-destination', app], join(repo, 'packages', 'dopus'))
const tarball = readdirSync(app).find((f) => f.endsWith('.tgz'))
renameSync(join(app, tarball), join(app, 'dopus.tgz'))

const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
pkg.dependencies.dopus = 'file:./dopus.tgz'
delete pkg.devDependencies['@opennextjs/aws']
delete pkg.devDependencies.vitest
writeFileSync(join(app, 'package.json'), JSON.stringify(pkg, null, 2))
const base = JSON.parse(readFileSync(join(repo, 'tsconfig.base.json'), 'utf8'))
const ts = JSON.parse(readFileSync(join(app, 'tsconfig.json'), 'utf8'))
delete ts.extends
ts.compilerOptions = { ...base.compilerOptions, ...ts.compilerOptions }
writeFileSync(join(app, 'tsconfig.json'), JSON.stringify(ts, null, 2))
writeFileSync(join(app, 'pnpm-workspace.yaml'), 'packages: []\n')
writeFileSync(join(app, '.gitignore'), 'node_modules\n.next\n')

run('pnpm', ['install'], app)
run(join(app, 'node_modules', '.bin', 'dopus'), ['infra', 'gcp', '--yes'], app)
// Test-only: the local dopus tarball must be in the deps stage too (a real app installs dopus from npm).
const dockerfile = readFileSync(join(app, 'Dockerfile'), 'utf8')
writeFileSync(
  join(app, 'Dockerfile'),
  dockerfile.replace(
    'COPY package.json pnpm-lock.yaml ./',
    'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml dopus.tgz ./',
  ),
)

// A canary secret in .env.local must not end up in the image (.dockerignore excludes .env files).
writeFileSync(join(app, '.env.local'), 'OPENAI_API_KEY=dopus-canary-must-not-ship\n')

const image = `dopus-gcp-e2e:${Date.now()}`
const port = 8600 + Math.floor(Math.random() * 200)
run('docker', ['build', '-t', image, '.'], app)
const container = execFileSync(
  'docker',
  [
    'run',
    '-d',
    '--rm',
    '-p',
    `127.0.0.1:${port}:8080`,
    '-e',
    'DOPUS_MOCK_MODEL=1',
    '-e',
    'DOPUS_APPROVAL_SECRET=gcp-e2e-secret-0123456789abcdef',
    image,
  ],
  { encoding: 'utf8' },
).trim()
const url = `http://127.0.0.1:${port}`
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(`${url}/login`)
      break
    } catch {
      if (i > 120)
        throw new Error(execFileSync('docker', ['logs', container], { encoding: 'utf8' }))
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  const leaked = execFileSync(
    'docker',
    ['exec', container, 'sh', '-c', 'grep -rl dopus-canary /app || true'],
    {
      encoding: 'utf8',
    },
  ).trim()
  if (leaked) throw new Error(`secret from .env.local found in the image:\n${leaked}`)
  console.log('no .env.local secret in the image')
  run('pnpm', ['vitest', 'run'], example, { env: { ...env, E2E_BASE_URL: url } })
  console.log(`\ngcp-e2e: OK (${work})`)
} finally {
  execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' })
  execFileSync('docker', ['rmi', image], { stdio: 'ignore' })
}
