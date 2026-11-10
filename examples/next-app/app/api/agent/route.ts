import { createAgentHandler } from 'dopus'
import agent from '../../../agent.config'

// Agent replies stream for a while; raise this if your platform cuts requests short.
export const maxDuration = 60

export const POST = createAgentHandler(agent)
