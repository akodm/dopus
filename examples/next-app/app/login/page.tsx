import { signIn } from '../actions/auth'

export default function LoginPage() {
  return (
    <main style={{ padding: 40, fontFamily: 'system-ui' }}>
      <h1>Sign in</h1>
      <form action={signIn} style={{ display: 'flex', gap: 8 }}>
        <button type="submit" name="user" value="alice">
          Sign in as alice
        </button>
        <button type="submit" name="user" value="bob">
          Sign in as bob
        </button>
        <button type="submit" name="user" value="dana">
          Sign in as dana (admin)
        </button>
      </form>
    </main>
  )
}
