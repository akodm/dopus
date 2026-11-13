// Asserts the build output keeps the server entries free of React/client code and every client file marked
// 'use client'. Server and client outputs are told apart by what each set of entries reaches through relative imports.
import { readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')
const SERVER_ENTRIES = ['index.js', 'cli.js']
const CLIENT_ENTRIES = ['react.js', 'plugins.js']
const CLIENT_PACKAGES = ['react', 'react-dom', 'next', '@ai-sdk/react']

const read = (f) => readFileSync(join(dist, f), 'utf8')
// Static imports/exports at the start of a line, plus dynamic import()/require() in code position (not inside
// a string such as a generated config template).
const SPECIFIER =
  /(?:^\s*(?:import|export)\b[^'"\n]*?|^\s*import\s*|\bfrom\s*)["']([^"']+)["']|(?:^|[=(,;:?&|!]\s*|\bawait\s+|\breturn\s+)(?:import\s*\(|require\s*\()\s*["']([^"']+)["']/gm
const specifiers = (code) => [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2])
const isClientPackage = (s) => CLIENT_PACKAGES.some((p) => s === p || s.startsWith(`${p}/`))

// Every dist file reachable from the entries through relative imports.
const closure = (entries) => {
  const seen = new Set()
  const visit = (f) => {
    if (seen.has(f)) return
    seen.add(f)
    for (const s of specifiers(read(f))) if (/^\.\/[^/]+\.js$/.test(s)) visit(normalize(s))
  }
  for (const e of entries) visit(e)
  return seen
}

const server = closure(SERVER_ENTRIES)
const client = closure(CLIENT_ENTRIES)
const errors = []

for (const f of server) {
  if (client.has(f)) errors.push(`dist/${f} is shared by server and client entries`)
  for (const s of specifiers(read(f))) {
    if (isClientPackage(s)) errors.push(`dist/${f} (server) imports "${s}"`)
  }
}
for (const f of client) {
  if (!/^(['"])use client\1/.test(read(f)))
    errors.push(`dist/${f} (client) must start with 'use client'`)
}

if (errors.length) throw new Error(`check-build failed:\n${errors.join('\n')}`)
console.log(`check-build OK (server: ${[...server].join(', ')}; client: ${[...client].join(', ')})`)
