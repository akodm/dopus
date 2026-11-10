import { createAgentHandler } from 'dopus'
import agent from '@/agent.config'

export const POST = createAgentHandler(agent)
