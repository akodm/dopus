#!/usr/bin/env node
// Copies examples/next-app to a temp dir, installs the packed dopus tarball, runs `dopus infra cloudflare`,
// builds with @opennextjs/cloudflare, serves it with `wrangler dev` (local workerd, no Cloudflare account),
// and runs the example's e2e suite against it. Nothing is deployed.
import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..')
const example = join(repo, 'examples', 'next-app')
const work = mkdtempSync(join(tmpdir(), 'dopus-cf-'))
const app = join(work, 'app')
const env = {
  ...process.env,
  CI: '1',
  WRANGLER_SEND_METRICS: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env })

run('pnpm', ['pack', '--pack-destination', work], join(repo, 'packages', 'dopus'))
const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'))

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

const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
pkg.dependencies.dopus = `file:../${tarball}`
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
run(join(app, 'node_modules', '.bin', 'dopus'), ['infra', 'cloudflare', '--yes'], app)
appendFileSync(
  join(app, '.dev.vars'),
  'DOPUS_MOCK_MODEL=1\nDOPUS_APPROVAL_SECRET=cf-e2e-secret-0123456789abcdef\n',
)
run(join(app, 'node_modules', '.bin', 'opennextjs-cloudflare'), ['build'], app)

const port = 8700 + Math.floor(Math.random() * 200)
const server = spawn(
  join(app, 'node_modules', '.bin', 'wrangler'),
  ['dev', '--port', String(port), '--ip', '127.0.0.1'],
  {
    cwd: app,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
const url = `http://127.0.0.1:${port}`
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(`${url}/login`)
      break
    } catch {
      if (i > 120 || server.exitCode !== null)
        throw new Error(`wrangler dev did not start:\n${log}`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  execFileSync('pnpm', ['vitest', 'run'], {
    cwd: example,
    stdio: 'inherit',
    env: { ...env, E2E_BASE_URL: url },
  })
  console.log(`\ncloudflare-e2e: OK (${work})`)
} finally {
  server.kill()
}
