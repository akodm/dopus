export {
  type AgentConfig,
  type ClientContext,
  createAgentHandler,
  defineAgent,
  type FinishEvent,
  type HandlerOptions,
  type ToolCallEvent,
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
  type AgentUIMessage,
  type AgentUser,
  type ConfirmOption,
  type DopusTool,
  type DopusToolSet,
  defineTool,
  type InferAgentUITools,
  type ToolContext,
  type ToolInput,
  type ToolOptions,
  type ToolOutput,
} from './tool.js'

export { VERSION } from './version.js'
