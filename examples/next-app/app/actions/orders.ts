'use server'

import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { store } from '@/lib/store'

/** Ordinary server actions, written for the app's own pages. The agent reuses them as-is. */

export async function getCurrentUser() {
  const session = await getSession()
  return session ? { signedIn: true, user: session.user } : { signedIn: false }
}

export async function listMyOrders() {
  const session = await getSession()
  if (!session) redirect('/login')
  return store.ordersOf(session.user)
}

/** Admin page: every customer's orders. */
export async function listAllOrders() {
  const session = await getSession()
  if (!session) redirect('/login')
  // The real permission check. The agent's `access` option only hides the tool from non-admins.
  if (session.role !== 'admin') throw new Error('Forbidden')
  return store.all()
}

export async function cancelOrder(orderId: string) {
  const session = await getSession()
  if (!session) redirect('/login')
  const order = store.find(orderId)
  // The app's own permission check — the agent cannot bypass it.
  if (!order || order.owner !== session.user) return { ok: false, error: 'Order not found.' }
  if (order.status !== 'open') return { ok: false, error: `Order is already ${order.status}.` }
  order.status = 'cancelled'
  return { ok: true, order }
}
