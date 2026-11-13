// Asserts the build output keeps the server entries free of React and the client entries marked 'use client'.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')
const read = (f) => readFileSync(join(dist, f), 'utf8')

for (const f of ['react.js', 'plugins.js']) {
  if (!/^(['"])use client\1/.test(read(f)))
    throw new Error(`dist/${f} must start with 'use client'`)
}
for (const f of ['index.js', 'cli.js']) {
  if (/from ["']react["']/.test(read(f))) throw new Error(`dist/${f} must not import react`)
}
console.log('check-build OK')
