# Changelog

## Unreleased

- `dopus infra aws`: writes `open-next.config.ts` with Lambda response streaming, installs `@opennextjs/aws`, prints an
  `sst.aws.Nextjs` snippet with the API key and approval secret as SST secrets.
- `dopus infra cloudflare`: writes `open-next.config.ts` (`defineCloudflareConfig`), `wrangler.jsonc`, `.dev.vars`;
  adds `cf:preview` / `cf:deploy`; git-ignores build output and `.dev.vars`; optionally copies the API key and approval
  secret from `.env.local` into `.dev.vars` (wrangler does not read `.env.local` when `.dev.vars` exists).
- `keepAlive` (default 15 s): SSE comments while the stream is idle, so CloudFront / ALB / proxies keep long tool calls open.

## 0.1.0 — 2026-11-10

First release.

- `defineTool(fn, { description, usage, input, confirm, output })` registers existing server functions as agent tools.
- `defineAgent` / `createAgentHandler`: `POST` route handler on AI SDK 7 (`streamText`, UI message stream). Tools run
  inside the request, so they inherit the caller's cookies and permissions.
- Confirm-before-write via AI SDK `toolApproval`; approvals HMAC-signed with `DOPUS_APPROVAL_SECRET`.
- Four prompt layers (core, preset, app, runtime) ordered for prompt caching; Anthropic cache breakpoint; per-locale notes.
- Error policy: only `ToolError` and translated Next.js `redirect`/`notFound`/`forbidden`/`unauthorized` reach the model.
- `dopus init`: provider (OpenAI / Anthropic / Google), masked API key → `.env.local`, prompt preset
  (general / customer-support / internal-ops), route, config, prompts and chat UI (`AgentChat`, `AgentWidget`) copied
  into the project; installs missing dependencies; idempotent; monorepo-aware package manager detection.
