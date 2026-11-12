'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function signIn(formData: FormData) {
  const user = String(formData.get('user') ?? '')
  if (user !== 'alice' && user !== 'bob' && user !== 'dana') throw new Error('Unknown user')
  ;(await cookies()).set('session', user, { httpOnly: true, sameSite: 'lax', path: '/' })
  redirect('/')
}

export async function signOut() {
  ;(await cookies()).delete('session')
  redirect('/')
}
