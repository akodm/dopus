import { describe, expect, it } from 'vitest'
import { specifiers } from '../scripts/specifiers.mjs'

describe('check-build specifiers', () => {
  it('finds static imports and exports', () => {
    const code = [
      "import { a } from './a.js'",
      "import './side.js'",
      "export { b } from './b.js'",
      "export * from 'react'",
    ].join('\n')
    expect(specifiers(code)).toEqual(['./a.js', './side.js', './b.js', 'react'])
  })

  it('finds dynamic imports in code position, including the arrow form', () => {
    const code = [
      "const load = () => import('./chunk.js')",
      "const m = await import('./other.js')",
      "lazy(() => { return import('./third.js') })",
      "const pick = cond ? import('./x.js') : null",
      "const all = [import('./y.js')]",
      "const cjs = require('next')",
    ].join('\n')
    expect(specifiers(code)).toEqual([
      './chunk.js',
      './other.js',
      './third.js',
      './x.js',
      './y.js',
      'next',
    ])
  })

  it('ignores a JSDoc import() type inside a generated file', () => {
    const code = `writeFileSync(path, "/** @type {import('next').NextConfig} */\\nexport default {}")`
    expect(specifiers(code)).toEqual([])
  })

  it('ignores import() written inside a string', () => {
    const code = `const help = "to load it lazily, call import('react') yourself"`
    expect(specifiers(code)).toEqual([])
  })
})
