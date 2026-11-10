import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

// The example app is the output of `dopus init`; its copy-in files must not drift from the templates.
describe('example app copies', () => {
  it.each([
    [
      'packages/dopus/templates/ui/agent-chat.tsx',
      'examples/next-app/components/agent/agent-chat.tsx',
    ],
    [
      'packages/dopus/templates/ui/agent-chat.module.css',
      'examples/next-app/components/agent/agent-chat.module.css',
    ],
    [
      'packages/dopus/templates/prompts/presets/customer-support.ts',
      'examples/next-app/agent/prompts/preset.ts',
    ],
  ])('%s matches the example', (template, copy) => {
    expect(read(copy)).toBe(read(template))
  })
})
