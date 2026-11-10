export {
  type AgentConfig,
  buildTools,
  type ClientContext,
  createAgentHandler,
  defineAgent,
  readClientContext,
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
  isDopusTool,
  type ToolContext,
  type ToolOptions,
} from './tool.js'

export { VERSION } from './version.js'
