import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDefinitions, isEnvLocalIgnored, parseEnvKeys, upsertEnv } from '../src/init/env.js'

describe('parseEnvKeys', () => {
  it('reads keys, export prefixes and quoted values; ignores comments', () => {
    const keys = parseEnvKeys('# c\nA=1\nexport B="two"\nC=\n  D = \'x\'\nnot a line')
    expect([...keys]).toEqual([
      ['A', '1'],
      ['B', 'two'],
      ['C', ''],
      ['D', 'x'],
    ])
  })
})

describe('upsertEnv', () => {
  it('appends new keys under a header', () => {
    const { content, changed } = upsertEnv('A=1\n', { KEY: 'sk-123', S: 'with space' })
    expect(content).toBe('A=1\n\n# dopus\nKEY=sk-123\nS="with space"\n')
    expect(changed).toEqual(['KEY', 'S'])
  })

  it('fills empty placeholders in place and keeps existing values', () => {
    const { content, changed } = upsertEnv('KEY=\nOTHER=keep\n', { KEY: 'new', OTHER: 'x' })
    expect(content).toBe('KEY=new\nOTHER=keep\n')
    expect(changed).toEqual(['KEY'])
  })

  it('replaces existing values only when asked', () => {
    expect(upsertEnv('KEY=old\n', { KEY: 'new' }, ['KEY']).content).toBe('KEY=new\n')
  })

  it('handles empty files', () => {
    expect(upsertEnv('', { KEY: 'v' }).content).toBe('# dopus\nKEY=v\n')
  })
})

describe('env files', () => {
  it('reports which files define a key without returning values', () => {
    const root = mkdtempSync(join(tmpdir(), 'dopus-env-'))
    writeFileSync(join(root, '.env'), 'OPENAI_API_KEY=sk-in-env\n')
    writeFileSync(join(root, '.env.local'), 'OPENAI_API_KEY=\n')
    expect(findDefinitions(root, 'OPENAI_API_KEY')).toEqual(['.env'])
  })

  it('falls back to .gitignore patterns outside a git repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'dopus-env-'))
    expect(isEnvLocalIgnored(root)).toBe(false)
    writeFileSync(join(root, '.gitignore'), 'node_modules\n.env*.local\n')
    expect(isEnvLocalIgnored(root)).toBe(true)
  })
})
