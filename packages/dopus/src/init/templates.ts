import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDERS, type ProviderId } from '../providers.js'

export const PRESETS = [
  { id: 'general', label: 'General assistant' },
  { id: 'customer-support', label: 'Customer support' },
  { id: 'internal-ops', label: 'Internal operations / admin' },
] as const

export type PresetId = (typeof PRESETS)[number]['id']

/** Finds the package's `templates/` directory from either `src/` (tests) or `dist/` (published). */
function templatesDir() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'templates')
    if (existsSync(join(candidate, 'ui', 'agent-chat.tsx'))) return candidate
    dir = dirname(dir)
  }
  throw new Error('dopus: templates directory not found (broken install?)')
}

export function readTemplate(path: string) {
  return readFileSync(join(templatesDir(), path), 'utf8')
}

export function agentConfigTemplate(provider: ProviderId, model: string) {
  const info = PROVIDERS[provider]
  return `import { ${info.importName} } from '${info.packageName}'
import { defineAgent, defineTool } from 'dopus'
import { z } from 'zod'
import app, { locales } from './agent/prompts/app'
import preset from './agent/prompts/preset'

/**
 * Register your existing server functions as tools. They run inside the agent request,
 * so cookies() / headers() see the signed-in user and your own permission checks apply.
 *
 *   import { getOrders } from '@/app/actions/orders'
 *
 *   getOrders: defineTool((input) => getOrders(input.status), {
 *     description: "Lists the signed-in user's orders.",
 *     usage: 'When the user asks about their orders.',
 *     input: z.object({ status: z.enum(['open', 'closed']).optional() }),
 *   }),
 *
 * Add \`confirm: true\` to anything that changes data; the user approves each call in the chat.
 */
export default defineAgent({
  model: ${info.importName}('${model}'),
  tools: {
    currentTime: defineTool(async () => new Date().toISOString(), {
      description: 'Returns the current date and time (ISO 8601, server time).',
      usage: 'When the answer depends on today’s date or the current time.',
      input: z.object({}),
    }),
  },
  // Prompt layers, stable → volatile: dopus core rules → preset → app context → per-request runtime.
  prompt: { preset, app, locales },
  // Per-request facts from the server (never from the browser), e.g. the user's role:
  // runtime: async () => ({ role: (await getSession())?.role }),
})
`
}

export function routeTemplate(configImport: string) {
  return `import { createAgentHandler } from 'dopus'
import agent from '${configImport}'

// Agent replies stream for a while; raise this if your platform cuts requests short.
export const maxDuration = 60

export const POST = createAgentHandler(agent)
`
}
