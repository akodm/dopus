export type ProviderId = 'openai' | 'anthropic' | 'google'

export interface ProviderInfo {
  id: ProviderId
  label: string
  /** npm package that provides the model factory. */
  packageName: string
  /** Named export of the default provider instance. */
  importName: string
  /** Environment variable the provider package reads the API key from. */
  envVar: string
  defaultModel: string
}

/** Verified against @ai-sdk/openai@4.0.111, @ai-sdk/anthropic@4.0.99, @ai-sdk/google@4.0.114. */
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    packageName: '@ai-sdk/openai',
    importName: 'openai',
    envVar: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.5',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    packageName: '@ai-sdk/anthropic',
    importName: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-5-5',
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    packageName: '@ai-sdk/google',
    importName: 'google',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    defaultModel: 'gemini-3.5-flash',
  },
}
