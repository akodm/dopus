# Changelog

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
