# dopus

Drop an AI agent into your existing Next.js (App Router) app. Your existing server functions become the agent's tools — and because they run inside the same request, they inherit the signed-in user's cookies and permissions.

> Status: pre-release (0.0.0). Not published yet.

## Repo layout

- `packages/dopus` — runtime (`defineTool`, agent route handler) and the `dopus` CLI
- `examples/next-app` — Next.js app used for local and CI checks
- `docs/design.md` — design notes

## Development

```bash
pnpm install
pnpm build
pnpm lint && pnpm typecheck && pnpm test
pnpm example:build
```

Requires Node 22+ (AI SDK 7 requirement) and pnpm 10.
