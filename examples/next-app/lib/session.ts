import { cookies } from 'next/headers'

/**
 * Stand-in for your real auth (NextAuth, Clerk, Lucia, a JWT cookie, ...).
 * The point of the example: the agent's tools call ordinary server functions, and those
 * functions read the session from the caller's cookies exactly as they do for normal requests.
 */
export async function getSession() {
  const user = (await cookies()).get('session')?.value
  return user ? { user } : null
}
