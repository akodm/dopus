import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const source = readFileSync(join(root, 'templates/ui/agent-chat.css'), 'utf8')
// Rules only: section comments name classes too.
const css = source.replace(/\/\*[\s\S]*?\*\//g, '')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// Class names the package renders. Skips message part types like `data-dopus-job` (preceded by `-`).
const used = new Set(
  ['src/react', 'src/plugins'].flatMap((dir) =>
    sources(join(root, dir)).flatMap(
      (file) => readFileSync(file, 'utf8').match(/(?<![\w-])dopus-[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [],
    ),
  ),
)

describe('agent-chat.css', () => {
  it('finds the classes the package renders', () => {
    expect(used.has('dopus-chat')).toBe(true)
    expect(used.has('dopus-attachment-remove')).toBe(true)
    expect(used.has('dopus-job')).toBe(false)
  })

  it.each([...used].sort())('defines .%s', (name) => {
    expect(css).toMatch(new RegExp(`\\.${name}(?![\\w-])`))
  })

  it('has the 11 sections in order', () => {
    const headings = [
      '1. Theme',
      '2. Floating button',
      '3. Chat frame',
      '4. Message list',
      '5. Assistant text',
      '6. Composer',
      '7. Buttons and links',
      '8. Status',
      '9. Plugin: tool log',
      '10. Plugin: approvals',
      '11. Plugin: attachments',
    ]
    const positions = headings.map((heading) => source.indexOf(`/* ${heading}`))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})
