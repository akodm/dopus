import Link from 'next/link'
import { getSession } from '@/lib/session'
import { store } from '@/lib/store'
import { signOut } from './actions/auth'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const session = await getSession()
  return (
    <main style={{ padding: 40, fontFamily: 'system-ui', maxWidth: 640 }}>
      <h1>dopus example shop</h1>
      {session ? (
        <>
          <p>
            Signed in as <b>{session.user}</b>.{' '}
            <form action={signOut} style={{ display: 'inline' }}>
              <button type="submit">Sign out</button>
            </form>
          </p>
          <h2>Your orders</h2>
          <ul>
            {store.ordersOf(session.user).map((order) => (
              <li key={order.id}>
                {order.id} · {order.item} · {order.status}
              </li>
            ))}
          </ul>
          <p>Ask the assistant (bottom right) to list or cancel orders. It can only touch yours.</p>
        </>
      ) : (
        <p>
          <Link href="/login">Sign in</Link> to see your orders.
        </p>
      )}
    </main>
  )
}
