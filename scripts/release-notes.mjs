#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version: node scripts/release-notes.mjs 0.1.0
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const version = process.argv[2]?.replace(/^v/, '')
if (!version) throw new Error('usage: release-notes.mjs <version>')
const changelog = readFileSync(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8')
const start = changelog.search(new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b.*$`, 'm'))
if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`)
const rest = changelog.slice(start).split('\n').slice(1)
const end = rest.findIndex((line) => line.startsWith('## '))
console.log((end === -1 ? rest : rest.slice(0, end)).join('\n').trim())
