# Changelog

## Unreleased

- Time budget: `createAgentHandler(agent, { maxDuration })`. Once 75% of the route's `maxDuration` has passed, the
  agent starts no more tool calls and answers with what it has, instead of being cut off by the platform. The
  generated route passes it; existing projects change `createAgentHandler(agent)` to
  `createAgentHandler(agent, { maxDuration })`. Checked with Claude (tool history plus `toolChoice: 'none'`).
- README: "Timeouts and long-running tools": idle vs total limits, the time budget, and the start-job/status-tool
  pattern for work longer than a request.

## 0.2.3 — 2026-11-11

- `limits: { maxBodyBytes, maxMessageChars }` (defaults 1 MB and 8000): oversized requests get 413 before the model
  is called.
- README: a prompt-injection section listing what is enforced structurally (permissions, signed approvals, plain-text
  UI, limits) and what app developers must do (`confirm` on every write or send tool, untrusted tool data, no secrets
  in prompts). Checked with Claude against indirect injection planted in another user's task title.
- Core prompt: a declined confirmation is acknowledged as the user's choice, not reported as a failure, and the model
  is told not to narrate its own reasoning (Claude was showing "the task is assigned to the user, so I can move it").
- `internal-ops` preset: one sentence after a single change; counts only for bulk changes.

## 0.2.2 — 2026-11-11

Found by installing dopus 0.2.1 into a fresh `create-next-app@16.4.6` project:

- Fix: the chat UI was unstyled in create-next-app's default Tailwind setup, whose Turbopack rule for `*.css` also
  catches CSS Modules. `dopus init` now writes `components/agent/agent-chat.css` (plain global CSS, every class
  prefixed `dopus-`) instead of `agent-chat.module.css`. Existing projects: copy the new `agent-chat.tsx` and
  `agent-chat.css` from `templates/ui/` (or run `dopus init --force`, which also rewrites the other generated files).
- Chat UI: closing the widget no longer discards the conversation, and the page re-renders (`router.refresh()`)
  after a tool ran, so server components show the changed data.
- Prompt templates use named default exports, so `eslint-config-next` shows no warnings.
- `dopus init --help` and `dopus infra <target> --help` print the help instead of an unknown-option error.
- `pnpm smoke` now runs against a real `create-next-app` project: ESLint with zero warnings, build with
  `cacheComponents`, and a check that the served page has the widget and its styles.

## 0.2.1 — 2026-11-11

- Fix: a `ToolError` message (including translated `redirect()` / `notFound()` errors) now reaches the client as the
  tool's `errorText` instead of a generic "Something went wrong". The chat history the client sends on the next turn
  carries it, so the model still knows why an earlier call failed. Expected `ToolError`s are no longer passed to
  `onError`, and unexpected tool errors are reported once instead of twice. Found with the first real-model run.
- Example: `pnpm example:live` runs five scenarios against the real model (costs a few cents, not in CI).

## 0.2.0 — 2026-11-10

- `dopus infra aws`: writes `open-next.config.ts` with Lambda response streaming, installs `@opennextjs/aws`, prints an
  `sst.aws.Nextjs` snippet with the API key and approval secret as SST secrets.
- `dopus infra cloudflare`: writes `open-next.config.ts` (`defineCloudflareConfig`), `wrangler.jsonc`, `.dev.vars`;
  adds `cf:preview` / `cf:deploy`; git-ignores build output and `.dev.vars`; optionally copies the API key and approval
  secret from `.env.local` into `.dev.vars` (wrangler does not read `.env.local` when `.dev.vars` exists).
- `dopus infra gcp`: sets `output: 'standalone'` (asks first), writes a multi-stage `Dockerfile` (pins the project's
  pnpm/yarn version via corepack) and a `.dockerignore` that keeps `.env*` / `.dev.vars` out of the image; prints Secret
  Manager and `gcloud run deploy --source . --timeout 3600 --set-secrets …` commands.
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
