import { PROVIDERS, type ProviderId } from '../providers.js'

export function agentConfigTemplate(provider: ProviderId, model: string) {
  const info = PROVIDERS[provider]
  return `import { ${info.importName} } from '${info.packageName}'
import { defineAgent, defineTool } from 'dopus'
import { z } from 'zod'

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
  prompt: {
    app: 'Describe your service here: what it does, who uses it, and the words your users use.',
  },
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
