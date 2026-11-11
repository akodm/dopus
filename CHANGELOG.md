# Changelog

## Unreleased

- Tests: browser tests of the copied chat UI (Playwright, scripted model) run in CI and before every release:
  approve, decline, approve all, cards left open while the user writes (including one approved, the 0.2.8 bug),
  background job follow-up, the unread dot, the over-long message. The example app gained a background export job
  with an SSE channel.
- Example app: its in-memory store lives on `globalThis`. A production build loaded the module separately for the
  pages and the agent route, so the page did not show changes the agent made (the browser tests found this; apps
  with a database are not affected).

## 0.2.8 — 2026-11-11

- Fix: typing a new message while approval cards were open broke the chat. The model lost its own proposal and
  asked for the same changes again, and once one of those older cards had been approved, every later request in that
  conversation failed with a missing tool result (after newer approved tools had already run, so the chat lost
  their record). The route now settles cards in older messages before the model runs: still open or approved but
  never run → "not run" (a stale approval is never executed), declined → denied. Conversations already in that state
  work again.
- Core prompt: only the Approve button approves; a chat message is not an approval. When the user says to go ahead,
  the agent calls the tool again so a card appears.
- Chat UI: cards in older messages show "Not run" instead of live buttons, and "Approve all / Decline all" appear
  under two or more open cards (`labels.notRun`, `approveAll`, `declineAll`). Existing projects: `dopus update`.

## 0.2.7 — 2026-11-11

- `dopus update`: brings the files `init` copied (chat UI, route, preset prompt) up to the installed version's
  templates. Untouched copies are replaced; files you edited are never replaced without asking (diff, keep and save
  the new template as `<file>.new`, replace, or skip). `--dry-run`, `--yes` (edited files get `.new`), `--force`,
  `--no-install`. `agent.config.ts`, `app.ts` and `.env.local` are never touched. It recognises untouched copies
  from every release since 0.1.0, so existing projects can upgrade straight from any of them.
- Chat UI: the widget launcher shows a dot when a reply finishes while the panel is closed (e.g. the agent continuing
  after a background job), cleared when opened; `labels.unread`, and an `onReply` callback on `AgentChat`.

## 0.2.6 — 2026-11-11

- Background jobs: `defineTool(fn, { job: (result) => result.jobId })` marks a tool that starts work elsewhere (a
  Lambda, a queue) and returns at once. Give the chat UI a `channel` (Supabase Realtime, WebSocket, SSE, polling) and
  the agent continues by itself when the job finishes: the UI sends back only the job ID, the server writes the notice
  the model sees, and the agent reads the result with your own tool. Only jobs started in that chat are acted on,
  automatic follow-ups are capped (`maxJobFollowUps`, default 3), and confirmed tools still need approval.
- Existing projects: copy `templates/ui/agent-chat.tsx` and `agent-chat.css` to get the `channel` prop.
- Docs: dopus is positioned as a lightweight agent for Next.js. README states what it is for, what is out of scope
  (running long work itself, autonomous or multi-agent flows, built-in memory/RAG, other frameworks, running the
  agent outside the app) and how to design tools for it (few, fast, small results, batch instead of loop).
- Package description updated to match.

## 0.2.5 — 2026-11-11

- Hooks: `beforeRequest` (return a `Response`, e.g. 429, to stop before the model runs), `onToolCall` (every tool call
  with outcome `success` / `error` / `denied`, input, output or original error, duration) and `onFinish` (token usage
  summed over the request's steps, model, steps, duration). Hook errors go to `onError` and never break the chat.
- Chat UI: assistant replies render as Markdown (`react-markdown` + `remark-gfm`, installed by `init`). Raw HTML is
  never rendered, images show only alt text, links keep only http(s), mailto and relative URLs. Claude's tables and
  bold text showed as raw `|` and `**` before.
- Chat UI: a "New chat" button (`labels.newChat`), and a 413 from the size limits shows `labels.tooLong` with a new-chat
  action instead of a retry that would fail again.
- Existing projects: copy `templates/ui/agent-chat.tsx` and `agent-chat.css`, then
  `pnpm add react-markdown@^10 remark-gfm@^4`.

## 0.2.4 — 2026-11-11

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
