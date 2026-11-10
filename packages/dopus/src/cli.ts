#!/usr/bin/env node
import { VERSION } from './version.js'

const [command] = process.argv.slice(2)

if (command === '--version' || command === '-v') {
  console.log(VERSION)
} else {
  console.log(`dopus ${VERSION}\n\nUsage:\n  dopus init    Add an AI agent to this Next.js app`)
}
