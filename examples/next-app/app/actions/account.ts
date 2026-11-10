'use server'

import { cookies } from 'next/headers'

/** An ordinary server function — written for the app, not for the agent. */
export async function getCurrentUser() {
  const session = (await cookies()).get('session')?.value
  if (!session) return { signedIn: false as const }
  return { signedIn: true as const, userId: session }
}
