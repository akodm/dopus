export {
  type AgentConfig,
  type ClientContext,
  createAgentHandler,
  defineAgent,
  type HandlerOptions,
} from './agent.js'
export { ToolError } from './next-errors.js'
export {
  buildInstructions,
  CORE_PROMPT,
  type PromptLayers,
  type RuntimeContext,
} from './prompt.js'
export { PROVIDERS, type ProviderId, type ProviderInfo } from './providers.js'
export {
  type AgentUser,
  type ConfirmOption,
  type DopusTool,
  type DopusToolSet,
  defineTool,
  type ToolContext,
  type ToolOptions,
} from './tool.js'

export { VERSION } from './version.js'
