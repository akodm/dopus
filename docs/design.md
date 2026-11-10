# dopus design notes

## Goal

`pnpm add dopus && pnpm dopus init` adds a working agent to an existing Next.js App Router app.
Existing `'use server'` functions are registered as tools with `defineTool(fn, { description, usage, input, confirm })`.

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
  anything else is passed to `onError` and replaced with a generic message. The client always gets a generic error text.
- Approvals are HMAC-signed when `DOPUS_APPROVAL_SECRET` (or `approvalSecret`) is set; forged approvals are not executed.
- Peer deps: `ai@^7`, `zod@^4`. The provider package is the user's own dependency.

## Auth inheritance

Tools run in the route handler's request, so `cookies()` / `headers()` inside a server function see the caller's session.
This is the default and the main differentiator. When execution moves off-request (queues, background infra adapters),
the request context is gone: adapters must receive an explicit, serialisable user identity (`runtimeContext.user`) and
tools that need auth must accept it.
Verified in M1 on a `next start` (16.4.6) server: a tool executed mid-stream reads the caller's cookie via `cookies()`. That interface is designed in M1 even though adapters land in M6+.

## Prompt layers (stable → volatile, for provider prompt caching)

1. Core — shipped in the package, ~10–20 lines of tool-use and safety rules; overridable via config.
2. Preset — copied by `init` (e.g. customer support, internal ops); user-owned.
3. App context — user-written service description.
4. Runtime — locale/response language, user role, current page; injected per request.

## Milestones

M0 repo/CI · M1 runtime · M2 `init` CLI · M3 prompts + chat UI · M4 example + cookie test · M5 docs + 0.1.0 · M6+ AWS → Cloudflare → GCP adapters.
