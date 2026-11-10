#!/usr/bin/env node
// Packs dopus, installs the tarball into a fresh Next.js app, runs `dopus init`, then `next build`.
// Catches publishing mistakes (missing files, wrong exports) that workspace tests cannot see.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = join(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'dopus-smoke-'))
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

run('pnpm', ['pack', '--pack-destination', work], join(repo, 'packages', 'dopus'))
const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'))

const app = join(work, 'app')
mkdirSync(join(app, 'app'), { recursive: true })
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({
    name: 'smoke-app',
    private: true,
    type: 'module',
    dependencies: {
      dopus: `file:../${tarball}`,
      next: '16.4.6',
      react: '19.3.1',
      'react-dom': '19.3.1',
    },
    devDependencies: {
      '@types/node': '^24',
      '@types/react': '19.3.0',
      '@types/react-dom': '19.3.0',
      typescript: '6.0.3',
    },
  }),
)
writeFileSync(
  join(app, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['dom', 'dom.iterable', 'esnext'],
      strict: true,
      noEmit: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      jsx: 'preserve',
      skipLibCheck: true,
      isolatedModules: true,
      esModuleInterop: true,
      incremental: true,
      plugins: [{ name: 'next' }],
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }),
)
writeFileSync(
  join(app, 'app', 'layout.tsx'),
  `import { AgentWidget } from '../components/agent/agent-chat'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}<AgentWidget /></body></html>
}
`,
)
writeFileSync(
  join(app, 'app', 'page.tsx'),
  'export default function Page() { return <main>smoke</main> }\n',
)
writeFileSync(join(app, '.gitignore'), 'node_modules\n.next\n')
writeFileSync(join(app, 'pnpm-workspace.yaml'), 'packages: []\n')

run('pnpm', ['install'], app)
run(
  join(app, 'node_modules', '.bin', 'dopus'),
  ['init', '--provider', 'openai', '--preset', 'general', '--yes'],
  app,
)
run(join(app, 'node_modules', '.bin', 'next'), ['build'], app)
console.log(`\npack-smoke: OK (${work})`)
