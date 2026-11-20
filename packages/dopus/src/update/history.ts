import { createHash } from 'node:crypto'
import { readTemplate } from '../init/templates.js'

/** The generated route imports the agent config by a path that differs per project. */
export const CONFIG_IMPORT = /^import agent from ['"]([^'"]+)['"]/m

/** The chat wrapper imports its stylesheet by a path that differs per project too. */
const CSS_IMPORT = /^import ['"][^'"]*agent-chat\.css['"]/m

/**
 * The form two copies are compared in: per-project import paths replaced, and what formatters change (quote style,
 * semicolons, line breaks and indentation, trailing commas, spaces around punctuation) removed, so a copy that
 * Prettier or Biome reformatted still counts as untouched. A change to anything else is still a change.
 * Must match normalize() in scripts/template-history.mjs.
 */
export function normalize(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(CONFIG_IMPORT, "import agent from '<config>'")
    .replace(CSS_IMPORT, "import '<css>'")
    .replaceAll('"', "'")
    .replaceAll(';', '')
    .replace(/\s+/g, ' ')
    .replace(/ ?([{}()[\],:=<>+*/|&!?]) ?/g, '$1')
    .replace(/,([}\])\]])/g, '$1')
    .trim()
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
