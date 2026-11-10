import { anthropic } from '@ai-sdk/anthropic'
import { defineAgent, defineTool } from 'dopus'
import { z } from 'zod'
import { getCurrentUser } from './app/actions/account'
import { mockModel } from './lib/mock-model'

export default defineAgent({
  model: process.env.DOPUS_MOCK_MODEL === '1' ? mockModel() : anthropic('claude-sonnet-5-5'),
  tools: {
    getCurrentUser: defineTool(() => getCurrentUser(), {
      description: 'Returns whether the user is signed in and their user id.',
      usage: 'When the user asks who they are or whether they are signed in.',
      input: z.object({}),
    }),
  },
  prompt: { app: 'This is the dopus example app.' },
})
