import { createHash } from 'node:crypto'
import { readTemplate } from '../init/templates.js'

/** The generated route imports the agent config by a path that differs per project. */
export const CONFIG_IMPORT = /^import agent from ['"]([^'"]+)['"]/m

/** Must match normalize() in scripts/template-history.mjs. */
export function normalize(text: string) {
  return text.replace(/\r\n/g, '\n').replace(CONFIG_IMPORT, "import agent from '<config>'")
}

export function templateHash(text: string) {
  return createHash('sha256').update(normalize(text)).digest('hex').slice(0, 16)
}

/** Template key → hash → the first dopus version that shipped it. Written by scripts/template-history.mjs. */
export type TemplateHistory = Record<string, Record<string, string>>

let cached: TemplateHistory | undefined
export function templateHistory(): TemplateHistory {
  cached ??= JSON.parse(readTemplate('history.json')) as TemplateHistory
  return cached
}

/** The dopus version whose untouched template this is, or undefined if the user changed it. */
export function shippedIn(key: string, text: string): string | undefined {
  return templateHistory()[key]?.[templateHash(text)]
}
