# dopus design notes

## Goal

A lightweight agent for Next.js. `pnpm add dopus && pnpm dopus init` adds a working agent to an existing App Router app.
Existing `'use server'` functions are registered as tools with `defineTool(fn, { description, usage, input, confirm })`
and run inside the agent's request with the caller's permissions.

Scope (decided 2026-11-11): short tool calls inside one request — answers about the user's data and small changes.
Out of scope: long-running or background work (handed to the app's queue via start-job + status tools), autonomous or
multi-agent workflows, built-in memory/RAG, non-Next frameworks and the Pages Router, and running the agent outside the
Next.js app. `dopus infra` writes deploy config only. New features are judged against this scope.

Background jobs (decided 2026-11-11): long work still runs outside the agent, but the agent can pick it up again. A tool
marked `job` returns a job ID; the app's own channel (Supabase Realtime, WebSocket, SSE, polling) tells the chat UI the
job finished; the UI sends a `data-dopus-job` part carrying only the ID; the server turns it into notice text it writes
itself, and the agent reads the result through an app tool that checks permissions. The channel is a doorbell, never a
source of model text. The UI acts only on IDs started in that conversation, caps automatic follow-ups (default 3) and
waits while an approval is open. The follow-up needs the chat open in a browser; work that must go on without the user
stays in the app's worker. This keeps every agent turn short and inside a user request.

Direction (fixed 2026-11-12): an assistant that does only what the signed-in user, with their role, may do; quick to
add to a Next.js app with an LLM API key; the app's existing server functions as tools the model chooses from; deploy
config for some platforms and a channel for long-running work; chat history in the app's database (`onFinish`) or the
tab's sessionStorage, safe across several tabs of the same user.

Public tools (decided 2026-11-12): a tool marked `public` is also offered to users who are not signed in. With
`identify` returning `undefined`, only public tools reach the model and the runtime layer says sign-in is needed for the
rest; an approval for a hidden tool (signed out in another tab, then Approve) is settled as not run. Without `identify`
dopus cannot tell, so every tool is offered and `defineAgent` warns. Visibility only: the server functions keep the
permission checks.

Tools by role (decided 2026-11-12): `access: (user) => boolean` offers a tool only to signed-in users it allows. A
user who may not use it must not learn it exists, so it is dropped from the request with no runtime note (unlike the
anonymous case, where a generic sign-in note is fine). Fails closed: no `identify` or a throwing check means not
offered. `public` and `access` together are rejected. Hook and message types are inferred from the tools
(`ToolCallEvent<TOOLS>`, `AgentUIMessage<typeof agent>`); `defineTool`'s return uses `NoInfer` so the `tools` context
does not turn the output type into `any`.
MCP: possible through `@ai-sdk/mcp`, but external tools do not inherit the user's permissions; prefer wrapping the needed
call in a server function. If added: remote HTTP servers only, an `allow` list, writes confirmed by default.

## Package shape

One npm package, `dopus`:

- `dopus` (server runtime): `defineTool`, `createAgentHandler`, prompt layering.
- `dopus` bin: `init` (and later `prompts diff`).
- Templates (route, prompts, chat UI, `agent.config.ts`) are copied into the user's project (shadcn style) and owned by the user afterwards.

`ai` and the provider packages (`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`) are peer dependencies; `init` installs the chosen provider.

## AI SDK 7 notes (verified 2026-11-10 against ai-sdk.dev; ai@7.0.166)

- Node 22+, ESM only.
- `streamText({ instructions, messages, tools, toolApproval, stopWhen: isStepCount(n) })` — `system` → `instructions`, `stepCountIs` → `isStepCount`.
- Tool approval: `needsApproval` on `tool()` is deprecated; use `toolApproval` on the call: `{ toolName: 'user-approval' }` or a function.
  The stream emits `tool-approval-request`; the client answers with `addToolApprovalResponse({ id, approved, reason? })`
  and `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`.
- Response: `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })` (result-level helpers deprecated).
- Tool context: `toolsContext` (per tool, typed via `contextSchema`) and `runtimeContext` (shared).
- Google: `createGoogleGenerativeAI` → `createGoogle`.

## Runtime API (M1)

```ts
// agent.config.ts
export default defineAgent({
  model: anthropic('claude-sonnet-5-5'),
  tools: {
    getOrders: defineTool((i) => getOrders(i.status), { description, usage, input: z.object({...}) }),
    cancelOrder: defineTool(cancelOrder, { description, input, confirm: true }), // or (input, ctx) => boolean
  },
  prompt: { core?, preset?, app? },
  runtime: (req, { user }) => ({ locale, role, page }),
  identify: (req) => ({ id }) | undefined,   // only needed for off-request execution
  maxSteps: 10,
})
// app/api/agent/route.ts
export const POST = createAgentHandler(agent)
```

- Tool functions are called as `fn(input, { user, toolCallId, abortSignal })`; `output` maps results before the model sees them.
- Errors: only `ToolError` messages (and translated Next `redirect`/`notFound`/`forbidden`/`unauthorized`) reach the model;
  anything else is passed to `onError` and replaced with a generic message. The client gets the same `ToolError` text as the model (it must: the history it sends back is what the model sees next
  turn); any other error reaches it only as a generic text.
- Approvals are HMAC-signed when `DOPUS_APPROVAL_SECRET` (or `approvalSecret`) is set; forged approvals are not executed.
- Peer deps: `ai@^7`, `zod@^4`. The provider package is the user's own dependency.

## `dopus init` (M2)

1. Detects the project: `package.json` with `next`, `app/` or `src/app/`, `tsconfig.json`, package manager
   (`packageManager` field, then lockfile).
2. Provider select (OpenAI / Anthropic / Google) unless `--provider`.
3. API key: skipped if any of `.env.development.local`, `.env.local`, `.env.development`, `.env` already defines it.
   Otherwise a masked prompt; the value only goes to `.env.local` (created with mode 600), never to `.env` or the terminal.
   `DOPUS_APPROVAL_SECRET` is generated once. If git does not ignore `.env.local`, `.env*.local` is appended to `.gitignore`.
4. Writes `agent.config.ts` (root, or `src/` for `src/app`) and `<appDir>/api/agent/route.ts`.
   Existing files (including `.js` variants) are left alone; `--force` overwrites after a confirm.
5. Installs whatever of `dopus`, `ai@^7`, `zod@^4`, the provider package is missing (`--no-install` prints the command).
   Flags: `--provider`, `--model`, `--yes` (non-interactive, needs `--provider`, skips the key prompt), `--no-install`, `--force`, `--cwd`.

## Prompts and chat UI (M3)

`dopus init` copies (user-owned afterwards):

- `agent/prompts/preset.ts` — one of `general`, `customer-support`, `internal-ops` (`--preset`).
- `agent/prompts/app.ts` — service description template + optional `locales` notes (tone/terminology per language).
- `components/agent/agent-chat.tsx` + `.css` (global, `dopus-` prefixed; a CSS Module broke under create-next-app's Tailwind Turbopack rule) — `AgentChat` (panel) and `AgentWidget` (floating launcher):
  tool states, approve/decline card, stop/retry, suggestions, IME-safe Enter, `--dopus-*` CSS variables, dark mode.
  No Tailwind or component library needed.

Prompts are `.ts` modules (template strings), not `.md` read from disk, so they bundle on every runtime (Node, edge, serverless)
without file tracing.

Runtime layer: the chat UI sends `body.context = { page, locale }`. The server accepts only those two keys, strips control
characters and caps length (page 200, locale must be a BCP 47 tag; falls back to `Accept-Language`). Server values from
`runtime()` (e.g. `role`) override them. Per-language notes from `prompt.locales` are picked by locale and stay in the
cached prefix.

## Auth inheritance

Tools run in the route handler's request, so `cookies()` / `headers()` inside a server function see the caller's session.
This is the default and the main differentiator. dopus never moves tool execution off-request. When a tool hands work to
the app's own queue, the request context is gone there: `identify` gives tools `ctx.user` to pass on explicitly.
Verified in M1 on a `next start` (16.4.6) server: a tool executed mid-stream reads the caller's cookie via `cookies()`.

## Prompt layers (stable → volatile, for provider prompt caching)

1. Core — shipped in the package, ~10–20 lines of tool-use and safety rules; overridable via config.
2. Preset — copied by `init` (e.g. customer support, internal ops); user-owned.
3. App context — user-written service description.
4. Runtime — locale/response language, user role, current page; injected per request.

## Milestones

M0 repo/CI · M1 runtime · M2 `init` CLI · M3 prompts + chat UI · M4 example + cookie test · M5 docs + 0.1.0 · M6+ AWS → Cloudflare → GCP adapters.
The M6 adapters ended up as deploy-config generators (streaming, timeouts, secrets); the earlier idea of adapters that run
tools elsewhere was dropped when the scope was fixed as a lightweight agent (2026-11-11).

## AWS (M6)

Verified 2026-11-10 (OpenNext `@opennextjs/aws` 4.1.15, SST `dev` source):

- `default.override.wrapper: 'aws-lambda-streaming'` → `open-next.output.json` marks the server origin `streaming: true`;
  `sst.aws.Nextjs` passes that to its Function (`streaming` → Function URL invoke mode RESPONSE_STREAM). SST deploys only
  the default server function, so per-route function splitting is not used.
- SST sets the CloudFront origin read timeout to the server timeout; CloudFront allows 1–60 s (more by quota).
  CloudFront's response timeout applies to the first byte _and_ to gaps between packets; there is no total limit unless a
  response-completion timeout is set. Hence the runtime `keepAlive` heartbeat (SSE comment between events).
- `scripts/lambda-emu.mjs` invokes the real OpenNext bundle with Function URL (payload v2) events and the Lambda
  http-integration framing (JSON prelude + 8 NUL bytes). It runs in CI. Real deployments need the user's approval.

## Cloudflare (M6)

Verified 2026-11-10 (`@opennextjs/cloudflare` 1.20.16, wrangler 4.160.0):

- The example's full e2e suite passes on `wrangler dev` (local workerd): `cookies()` inside tools, ownership checks, signed
  approvals (secret from `.dev.vars` → `process.env`), forged approvals rejected.
- With `.dev.vars` present, wrangler does not read `.env.local` ("Using secrets defined in .dev.vars"), so
  `dopus infra cloudflare` offers to copy the provider key and approval secret.
- One `open-next.config.ts` per app: the command refuses to replace an AWS one.
- `compatibility_date` is set 30 days back so the installed workerd always supports it.

## Cloud Run (M6)

Verified 2026-11-10 with Docker 29 (no GCP account): the example's e2e suite passes against the generated image run with
`PORT=8080` and secrets as env vars; a canary secret in `.env.local` is absent from the final image.

- Cloud Run request timeout: default 300 s, max 3600 s, covering the whole response.
- Found while testing: corepack without a `packageManager` field fetches the newest pnpm, whose default
  `minimumReleaseAge` rejected a lockfile containing a day-old `next`. The Dockerfile therefore pins the local version.
- `addStandalone` only edits `const nextConfig = {…}`, `export default {}` and `module.exports = {}`; anything else gets
  a warning instead of a rewrite.

## Releasing

1. Bump `packages/dopus/package.json` and `src/version.ts` (a test keeps them equal), add a `CHANGELOG.md` section.
2. Commit, then push a tag `v<version>`. `.github/workflows/release.yml` (environment `git-action-publisher`) runs every
   check, then `npm stage publish` with trusted publishing (OIDC, provenance) and creates a _draft_ GitHub Release.
3. Approve the staged version on npmjs.com (Staged Packages, 2FA) or `npm stage approve <stage-id>`, then publish the
   draft release. The npm trusted publisher only has the "npm stage publish" permission, so CI can never publish alone.
4. 0.1.0 was published manually by the maintainer (first publish creates the package); later versions go through the workflow.
