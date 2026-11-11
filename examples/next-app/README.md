# dopus example

A small shop where users sign in as `alice` or `bob` and the assistant lists or cancels **their own** orders.
Generated with `dopus init --preset customer-support`, then `agent.config.ts` was edited to register the
existing server actions in `app/actions/orders.ts` as tools.

```bash
pnpm install && pnpm build                         # from the repo root
DOPUS_MOCK_MODEL=1 pnpm --filter next-app dev      # scripted model, no API key needed
```

With a real model: put `ANTHROPIC_API_KEY=...` in `examples/next-app/.env.local` and run without `DOPUS_MOCK_MODEL`.
`pnpm example:live` (after `pnpm example:build`) then checks five scenarios against that model: sign-in lookup, a Korean
reply, cancel with approval, another user's order, and an anonymous user. It costs a few cents and is not run in CI.

`pnpm example:e2e` (after `pnpm example:build`) starts `next start` and checks that tools see the caller's session
cookie, that the app's own permission checks still apply, and that writes wait for an approval.
