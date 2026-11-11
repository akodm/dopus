# dopus

A lightweight agent for Next.js. Hand it the server functions your app already has, and it does the user's tasks with
them, with the user's own permissions.

```bash
pnpm add dopus
pnpm dopus init
```

- **Reuse what you have.** Register the server actions and functions your app already has. You don't write a second API for the agent.
- **Permissions come for free.** Tools run inside the agent's request, so `cookies()` and `headers()` in your server functions see the signed-in user. Your own auth and ownership checks keep working unchanged.
- **Writes wait for the user.** Mark a tool `confirm: true` and the user approves each call in the chat. Approvals are signed so a client cannot forge one.
- **You own the generated code.** `init` copies the route, prompts and chat UI into your project, shadcn-style. Only the runtime lives in the package.

Built on the [Vercel AI SDK](https://ai-sdk.dev) 7. Supports OpenAI, Anthropic and Google models.

**What it is for.** An assistant inside your app that answers questions about the user's data and makes small changes
on request: "show my open orders", "move this task to done", "assign the deploy checklist to Carol". Each turn is a few
quick server-function calls inside one request, usually a few seconds.

**What it is not.** dopus stays small on purpose. These are out of scope:

- Running long work itself. A tool should finish in seconds. Longer jobs run in your own queue, Lambda or worker; a
  tool starts them, and the agent picks up again when your app announces they finished (see
  [Background jobs](#background-jobs)).
- Autonomous, scheduled or multi-agent workflows.
- Built-in memory, RAG or a vector store. If you need search over documents, expose it as a tool.
- Frameworks other than Next.js, and the Pages Router.
- Running the agent somewhere other than your Next.js app. `dopus infra` only writes the deploy config that keeps the
  agent route streaming on AWS, Cloudflare or Cloud Run.

---

## Quick start

Requirements: Next.js App Router, TypeScript, Node.js 22+, zod 4.

```bash
pnpm add dopus        # or npm / yarn / bun
pnpm dopus init
```

`init` asks for a provider, an API key and a prompt preset, then:

| Writes                                            | What it is                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.env.local`                                      | Your API key and a generated `DOPUS_APPROVAL_SECRET`. Never `.env`. Mode 600. |
| `agent.config.ts`                                 | Model, tools and prompt layers. Edit this.                                    |
| `agent/prompts/preset.ts`, `agent/prompts/app.ts` | Your prompt layers. Yours to edit.                                            |
| `app/api/agent/route.ts`                          | `POST /api/agent`. It speaks the AI SDK `useChat` protocol.                   |
| `components/agent/agent-chat.tsx` (+ `.css`)      | Chat panel and floating widget. Plain CSS with `dopus-` classes.              |

It also installs whatever is missing of `ai`, `zod`, `@ai-sdk/react` and the provider package. It checks that `.env.local` is git-ignored.

`init` is safe to run again. Existing files and env values are left alone unless you pass `--force` and confirm.

Then add the widget to your root layout:

```tsx
// app/layout.tsx
import { AgentWidget } from '../components/agent/agent-chat'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AgentWidget suggestions={['What are my open orders?']} />
      </body>
    </html>
  )
}
```

### CLI options

```
dopus init [--provider openai|anthropic|google] [--model <id>]
           [--preset general|customer-support|internal-ops]
           [--yes] [--no-install] [--force] [--cwd <dir>]
```

`--yes` runs without prompts. It needs `--provider` and skips the API key prompt, so add the key to `.env.local` yourself afterwards.

### Updating

`init` copies files into your project, so a new dopus version does not change them by itself. After upgrading the
package, bring them up to date:

```bash
pnpm add dopus@latest
pnpm dopus update            # --dry-run to only see what would change
```

`update` handles the files `init` copied: the chat UI (`agent-chat.tsx`, `agent-chat.css`), the route and the preset
prompt. It never touches `agent.config.ts`, `agent/prompts/app.ts` or `.env.local`.

- A file you never edited (it matches a template some dopus version shipped) is replaced.
- A file you edited is never replaced silently. You choose: see the diff, keep yours and get the new template next to
  it as `<file>.new` to merge by hand, replace it, or skip. `--yes` always takes the `.new` route; `--force` replaces.
- Packages the new chat UI needs are installed (`--no-install` prints the command instead).

Commit first, so `git diff` shows exactly what changed. The [changelog](CHANGELOG.md) says what each version changed
and anything to do in `agent.config.ts`.

## Tools

```ts
// agent.config.ts
import { anthropic } from '@ai-sdk/anthropic'
import { defineAgent, defineTool } from 'dopus'
import { z } from 'zod'
import { cancelOrder, listMyOrders } from './app/actions/orders' // your existing server actions
import app, { locales } from './agent/prompts/app'
import preset from './agent/prompts/preset'

export default defineAgent({
  model: anthropic('claude-sonnet-5-5'),
  tools: {
    listMyOrders: defineTool(() => listMyOrders(), {
      description: "Lists the signed-in user's orders with id, item and status.",
      usage: 'When the user asks about their orders.',
      input: z.object({}),
    }),
    cancelOrder: defineTool((input) => cancelOrder(input.orderId), {
      description: 'Cancels one open order of the signed-in user.',
      input: z.object({ orderId: z.string() }),
      confirm: true, // the user approves each call in the chat
    }),
  },
  prompt: { preset, app, locales },
})
```

`defineTool(fn, options)` calls `fn(input, ctx)`. If your function takes positional arguments, adapt it inline: `(input) => cancelOrder(input.orderId)`.

| Option        |                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `description` | **Required.** What the tool does. The model reads it.                                                    |
| `usage`       | When the tool should, or should not, be used. Appended to the description.                               |
| `input`       | **Required.** A zod schema. The model's arguments are validated before `fn` runs.                        |
| `confirm`     | `true`, or `(input, ctx) => boolean`, to ask the user before each call. Use it for anything that writes. |
| `output`      | `(result) => unknown`. Trims the result before the model sees it, for example to drop internal fields.   |

`ctx` is `{ user, toolCallId, abortSignal }`. `user` is only set when you configure `identify` (see below).

### Designing tools

A lightweight agent works best with small, fast tools:

- **Few.** Register the tools a user needs here, not every function you have. Past roughly 20 to 30 tools, models pick
  the wrong one more often, and every request carries every description.
- **Fast.** A tool should return in a second or two. Longer work belongs in a job (see
  [Timeouts and long-running tools](#timeouts-and-long-running-tools)).
- **Small results.** Take filters and a limit, and return only the fields the agent needs (`output` helps). A thousand
  rows cost tokens on every later step, and the whole history counts against `limits.maxBodyBytes`.
- **Batch, don't loop.** "Close all 200 stale tickets" should be one server function that takes a filter, not 200 calls.
  A turn allows at most `maxSteps` (10) model ↔ tool round trips.
- **Clear names and descriptions.** The model chooses by them. Say when _not_ to use a tool in `usage`.

### Errors

Only two kinds of error message reach the model:

- a `ToolError` you throw on purpose, such as `throw new ToolError('Order o-1 has already shipped')`;
- Next.js `redirect()`, `notFound()`, `forbidden()` and `unauthorized()`, which are translated into plain messages such as "the user is not signed in".

Any other error goes to `onError` and is replaced with a generic message, so database errors and stack details stay on the server. The browser sees the same text as the model: the `ToolError` message, or the generic one.

## Permissions and security

**How permission inheritance works.** `createAgentHandler` runs the whole tool loop inside the `POST /api/agent` request. A server function called as a tool therefore sees that request's cookies and headers, just as it does when your own UI calls it. The repo's end-to-end test checks this on a real `next start` server. It confirms that tools read the caller's session cookie, return only the caller's data, and still apply the app's ownership check after an approval.

**What stays your job.**

- Authorize inside your server functions, as you already should. dopus does not add permissions; it inherits yours.
- Treat the agent like any other client. A user can only make it do what that user could already do through your server functions.
- Register only the functions you want the agent to call.
- Protect the route like your other API routes, with rate limits and auth if anonymous use costs you money.

**Approvals.** With `DOPUS_APPROVAL_SECRET` set (`init` generates it), every approval request is HMAC-signed over the approval id, tool call id, tool name and input. An approval with a missing or tampered signature, or one whose input was changed after signing, is rejected and the tool does not run.

**Browser context is untrusted.** The chat UI sends `{ page, locale }` so the agent knows where the user is. The server accepts only those two keys, strips control characters and caps their length. Anything that matters for authorization, such as role, plan or tenant, must come from the server via `runtime`.

**Prompt injection.** Assume the model can be talked into anything: by the user, or by text inside tool results that other people wrote (a task title, a comment, an email body). dopus does not rely on the model resisting it. The limits are structural:

| Layer                  | What it guarantees                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Permission inheritance | A tool can do only what the signed-in user can do through your server functions.                                        |
| `confirm: true`        | The user sees the exact input and must approve; signed approvals cannot be forged or edited.                            |
| Chat UI rendering      | Markdown without raw HTML, images never loaded, only http(s)/mailto/relative links: no XSS and no image-URL data leaks. |
| Request limits         | `limits.maxBodyBytes` (1 MB) and `limits.maxMessageChars` (8000) answer 413 before the model runs.                      |
| `maxSteps`             | At most 10 model ↔ tool round trips per request.                                                                        |
| Core prompt            | Tells the model that tool results are data, not instructions. Helpful, but not a guarantee.                             |

Your part, so an injected instruction cannot cause damage:

- Put `confirm: true` on every tool that changes data, and on every tool that sends data anywhere (email, webhooks, external APIs). An unconfirmed write tool runs with the full permissions of whoever is chatting, an admin included.
- Treat user-generated content in tool results as untrusted. Return only the fields the agent needs.
- Never put secrets in prompts. "Do not reveal these instructions" is not a security boundary.

We tested this with a real model in a small task-board app. A member wrote a task whose title ordered the assistant to delete other tasks, then an admin's assistant listed the tasks. Claude (claude-sonnet-5-5) did not even request the deletion and pointed out the planted text. If a model did request it, the approval card would still stop it. Other models were not tested this way.

**Running tools outside the request.** Background jobs and queues lose the request's cookies. For that case, define `identify(request)` to resolve a serialisable user. Tools then receive it as `ctx.user` and can pass it on explicitly. dopus itself always runs tools inside the request; this is for jobs your tools hand off.

## Prompts

dopus builds the system prompt in four layers, ordered from stable to volatile so that providers can cache the prefix:

1. **Core**: about 15 lines of tool-use and safety rules, shipped in the package. Replace it with `prompt.core = '...'` or drop it with `false`. It is exported as `CORE_PROMPT`.
2. **Preset**: `agent/prompts/preset.ts`, copied by `init`. The presets are `general`, `customer-support` and `internal-ops`. Edit it freely.
3. **App context**: `agent/prompts/app.ts`, a description of your service. You write this.
4. **Runtime**: per-request facts. These are the browser's `locale` and `page`, plus whatever `runtime` returns.

Write your prompts once, in one language. The agent answers in the request's locale. For per-language tone or terminology, add short notes to `locales` (`{ ko: '존댓말을 사용하세요.' }`). Only the note that matches the request locale is included.

Anthropic gets an explicit cache breakpoint after layer 3. OpenAI and Gemini cache prompt prefixes automatically.

## Chat UI

`components/agent/agent-chat.tsx` exports two components:

- `<AgentChat />`: the panel;
- `<AgentWidget />`: a floating launcher that opens the panel.

Both accept `api`, `suggestions`, `labels` (every UI string, for translation), `className`, `channel` /
`maxJobFollowUps` for [background jobs](#background-jobs), and `history` to [keep the chat](#chat-history).

The UI shows each tool call as it runs. When a reply finishes while the widget is closed (for example the agent
continuing after a [background job](#background-jobs)), the launcher shows a dot until it is opened (`labels.unread`
for screen readers; `onReply` if you want your own signal). It renders an approve/decline card for confirmed tools and continues automatically once the user answers. When a tool has run, it calls `router.refresh()` so server components show the changed data. Closing the widget keeps the conversation, and a "New chat" button clears it. Assistant replies render as Markdown (tables, lists, code) through `react-markdown` with `remark-gfm`, which `init` installs. Raw HTML is never rendered, images show only their alt text, and links keep only http(s), mailto and relative URLs. If a request is over the size limit (413), the UI says so and offers a new chat instead of a useless retry. It also has stop and retry buttons, and it does not send on Enter while an IME (Korean, Japanese, Chinese) is still composing.

### Chat history

By default the conversation lives in memory: a reload starts a new chat. To keep it, pass `history` with `load`
(called once on mount) and `save` (called when the chat settles, and with `[]` on "New chat"). Where it goes is up to
you. Both hold functions, so set them up in a client component.

In this tab only (sessionStorage), keyed by user so that after a sign-out the next user in the tab does not see it:

```tsx
// components/agent/agent.tsx
'use client'
import { useMemo } from 'react'
import { type AgentChatHistory, type AgentChatProps, AgentWidget } from './agent-chat'

const sessionHistory = (key: string): AgentChatHistory => ({
  load: () => JSON.parse(sessionStorage.getItem(key) ?? '[]'),
  save: (messages) => sessionStorage.setItem(key, JSON.stringify(messages)),
})

export function Agent({ userId, ...props }: AgentChatProps & { userId: string }) {
  const history = useMemo(() => sessionHistory(`dopus-chat:${userId}`), [userId])
  return <AgentWidget {...props} history={history} />
}
```

In your database: save on the server, where you know the user, and load from the client.

```ts
// agent.config.ts
onFinish: async ({ user, messages }) => {
  if (user) await db.chat.upsert({ userId: user.id, messages })   // needs `identify`
},
```

```tsx
// components/agent/agent.tsx: loadChat is your server action returning the saved messages
;<AgentWidget
  history={{
    load: () => loadChat(),
    save: (m) => {
      if (m.length === 0) clearChat()
    },
  }}
/>
```

Things to know:

- **Tool results are stored too.** Whatever your tools returned (orders, names) is in the saved conversation. Keep it
  per user, and clear it on sign-out if the device may be shared.
- **It is still one conversation.** The browser sends the whole history with each message, so a long chat reaches the
  size limit (413) and the UI offers a new chat. There is no list of past chats.
- **Background jobs across a reload.** A job that finishes while the page is reloading is not announced again, so its
  "working in the background" line stays. The user can ask, and the agent reads the result with your status tool.

Styling is one plain CSS file (`agent-chat.css`) whose classes all start with `dopus-`, themed through `--dopus-*` variables, with dark mode included. It is deliberately not a CSS Module: create-next-app's Tailwind setup routes every `*.css` file, modules included, through its own Turbopack loader, which left module classes unstyled. It needs no Tailwind and no component library. The file is yours, so restyle it or swap in your own components.

## Configuration

```ts
defineAgent({
  model, // any AI SDK LanguageModel, e.g. openai('gpt-5.5')
  tools, // { name: defineTool(...) }; names match [a-zA-Z0-9_-]{1,64}
  prompt: { core, preset, app, locales },
  runtime: async (request, { user, client }) => ({ role: 'admin' }),
  identify: async (request) => ({ id: 'user-1' }), // optional
  maxSteps: 10, // model ↔ tool round trips per request
  limits: { maxBodyBytes: 1_000_000, maxMessageChars: 8_000 }, // over → 413
  beforeRequest,
  onToolCall,
  onFinish, // see "Audit log, usage and rate limits"
  approvalSecret, // default: process.env.DOPUS_APPROVAL_SECRET
  callOptions: {
    temperature,
    maxOutputTokens,
    providerOptions,
    maxRetries,
    headers,
    onEnd,
    onStepEnd,
  },
  onError: (error) => {}, // default: console.error
})
```

## Audit log, usage and rate limits

Three optional hooks in `defineAgent`. `user` in each comes from `identify`, so define it if you need to know who asked.

```ts
defineAgent({
  // ...
  identify: async () => {
    const session = await getSession()
    return session ? { id: session.userId } : undefined
  },

  // Before the model is called. Return a Response to answer with it instead.
  beforeRequest: async ({ user, request, messages }) => {
    const { success } = await ratelimit.limit(user?.id ?? ip(request))
    if (!success) return Response.json({ error: 'Too many requests' }, { status: 429 })
  },

  // Every tool call: outcome 'success' | 'error' | 'denied' (the user declined the approval).
  onToolCall: async ({ user, tool, input, outcome, output, error, durationMs }) => {
    await db.auditLog.insert({ userId: user?.id, tool, input, outcome, error, durationMs })
  },

  // Once per request, when the reply is done: tokens summed over all steps.
  // also gets `messages`: the whole conversation after this reply (see "Chat history")
  onFinish: async ({ user, model, usage, steps, finishReason, durationMs }) => {
    await db.usage.insert({ userId: user?.id, model: model.modelId, ...usage })
  },
})
```

- `onToolCall` gets the tool's original error message. It stays on the server; the model and the browser get the safe
  message described under [Errors](#errors).
- A hook that throws goes to `onError` and does not break the chat. Hooks are awaited, so a slow log write delays the
  reply; queue the write if that matters.
- `usage.cachedInputTokens` shows prompt caching at work. In the demo task board with Claude, about 90% of input tokens
  were cache reads.
- The chat UI shows a generic error for a 429. Pass your own `labels.error` if you want different wording.

## Timeouts and long-running tools

An agent turn can take a while: several model calls plus your tools. Two kinds of limits apply, handled differently.

**Idle timeouts** (CloudFront, ALB, nginx: usually 60 s without a byte). Handled:

- The route streams tokens and tool states as they happen; it never waits for the whole answer.
- While a slow tool runs, an SSE comment (`: keep-alive`) goes out every 15 s (`keepAlive` option). Clients ignore it.
- Waiting for an approval holds nothing open. The request ends at the approval card, and the answer starts a new one.

**The platform's total limit** for one request (Vercel `maxDuration`, Lambda timeout, Cloud Run `--timeout`). It cannot be
streamed around, so dopus stays inside it:

```ts
// app/api/agent/route.ts (as generated)
export const maxDuration = 60
export const POST = createAgentHandler(agent, { maxDuration })
```

With `maxDuration` passed, once 75% of it has passed the agent starts no more tool calls. It answers with what it has done
and says what is left, and the user can reply "continue". Without it, a long turn is cut off mid-stream and the chat shows
an error. A step already running (one model call or one tool) is not interrupted, so keep single tools well under the
limit. `maxSteps` (default 10) also bounds a turn.

**Tools that take longer than a request.** Exports, bulk updates, report generation and the like should not run inside a
tool call. Split them into two tools:

```ts
startExport: defineTool((input) => startExportJob(input), {   // enqueue, return { jobId } at once
  description: 'Starts a CSV export and returns a job id.',
  input: z.object({ from: z.string(), to: z.string() }),
  confirm: true,
}),
exportStatus: defineTool((input) => getExportJob(input.jobId), {   // { status, url? }
  description: 'Returns the status of an export job and its download link when done.',
  input: z.object({ jobId: z.string() }),
}),
```

The job runs in your queue or background worker, outside the request, so it does not have the request's cookies. Check
permissions in `startExportJob` and pass the user to the job explicitly (see `identify` and `ctx.user`). Have `getExportJob`
check that the job belongs to the caller.

With a status tool alone, the user has to ask "is it done?". To have the agent continue by itself when the job finishes,
mark the start tool with `job` and give the chat UI a channel: see [Background jobs](#background-jobs).

**If a turn is cut anyway**, tools that already ran stay done. "Retry" asks the model again and may call a tool again.
Tools behind `confirm: true` need a new approval; make other writes idempotent.

## Background jobs

For work that takes longer than a request: a Lambda that calls an LLM for a minute, a report, a bulk import. The tool
starts the job and returns at once; your worker does the work; your app announces "job X finished" on a channel it
already has (Supabase Realtime, a WebSocket, SSE, polling). The chat UI hears it and the agent continues: it reads the
result with another of your tools and does what the user asked next.

```
user: "build the workload report, then assign unassigned tasks to whoever is least busy"
  → startWorkloadReport          returns { jobId } at once; the agent says it started, the turn ends
  … your worker runs for a minute, saves the result, publishes "job-7 finished" on your channel …
  → the chat UI hears job-7      sends a notice carrying only the ID; a new turn starts
  → getReportResult({ jobId })   your tool reads the result and checks it belongs to the user
  → assignTask(...)              confirmed tools still stop at the approval card
```

**Server**: mark the tool that starts the job, and add a tool that reads the result.

```ts
startReport: defineTool(() => startReportJob(), {           // invoke the Lambda / enqueue, return { jobId } at once
  description: 'Starts the workload report. Takes about a minute.',
  input: z.object({}),
  job: (result) => result.jobId,                              // this tool starts a background job
}),
getReportResult: defineTool((input) => readReport(input.jobId), {   // check the job belongs to the caller
  description: 'Reads a report job by its id: status and, when done, the report.',
  usage: 'After the app says a report job has finished.',
  input: z.object({ jobId: z.string() }),
}),
```

`job` returns the job's ID (letters, digits, `_ . : -`, up to 128 characters). dopus tells the model the job runs in
the background and that it will be told when it finishes, so it does not poll.

**Client**: give the chat a `channel`. It holds functions, so create it in a client component, once:

```tsx
// components/agent/agent.tsx
'use client'
import { type AgentChannel, type AgentChatProps, AgentWidget } from './agent-chat'
import { supabase } from '@/lib/supabase/client'

const channel: AgentChannel = {
  subscribe(finished) {
    const ch = supabase
      .channel('jobs', { config: { private: true } })
      .on('broadcast', { event: 'job-done' }, ({ payload }) => finished(payload.jobId))
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  },
}

export function Agent(props: AgentChatProps) {
  return <AgentWidget {...props} channel={channel} />
}
```

Any source works: `new EventSource(url)`, a WebSocket, or a `setInterval` that asks your API which jobs finished. Call
`finished(jobId)` for each one; return a function that stops listening. Then use `<Agent />` in your layout instead of
`<AgentWidget />`.

**How it is kept safe:**

- **The channel is a doorbell, not a mailbox.** Only the job ID goes from the channel to the server. The text the model
  sees ("Background job X has finished…") is written by the server, and the result comes from your tool, which checks
  permissions. A forged or replayed event can at most make the agent look up a job the user can already read.
- **Only this chat's jobs.** The UI reacts only to IDs that a tool in this conversation returned and that it has not
  reported yet. Another tab, or a new chat, ignores them.
- **Follow-ups are capped.** After `maxJobFollowUps` (default 3) automatic turns in a row, a finished job is shown in
  the chat but the agent waits for the user's next message, so a job that starts another job cannot loop.
- **Approvals still apply.** An automatic turn stops at the approval card like any other.

**Limits:**

- The follow-up runs only while the chat is open in a browser. If the user closes the tab, the result is still in your
  app (show it there); the agent just does not act on it. Work that must continue without the user belongs in your
  worker, not in the agent.
- Each finished job costs one more model call.

## Deploying

The `dopus infra` commands write the deploy configuration that keeps the agent route streaming within each platform's
limits. The agent still runs inside your Next.js app; nothing is moved elsewhere.

**Vercel / any Node server.** Nothing extra. The route streams. Raise `maxDuration` in `app/api/agent/route.ts` if your plan allows it; the time budget follows it.

**AWS (OpenNext / SST).**

```bash
pnpm dopus infra aws
```

The command writes `open-next.config.ts` with Lambda response streaming (`aws-lambda-streaming`) and installs `@opennextjs/aws`. It also prints an `sst.aws.Nextjs` snippet that passes your API key and `DOPUS_APPROVAL_SECRET` as SST secrets.

SST reads OpenNext's streaming flag and sets the Function URL to `RESPONSE_STREAM`. Nothing is deployed for you.

Things to know:

- **Keep-alive.** While a tool runs and nothing else is sent, dopus writes an SSE comment (`: keep-alive`) every 15 s (`keepAlive` option). Clients ignore it. CloudFront, ALB and nginx time out on gaps between packets, not on total time, so a slow tool does not cut the stream.
- **Turn length.** A turn still has to finish within the Lambda timeout. Behind CloudFront that is 60 s by default (up to 180 s with a quota increase). A bare Function URL allows up to 15 min. Keep the route's `maxDuration` equal to the Lambda timeout so the time budget matches.
- **No API Gateway.** Don't put API Gateway HTTP APIs in front of `/api/agent`. They cap requests at 30 s and buffer the response.
- **Long-running work.** Work that outlives a request, such as queues and background jobs, loses the request's cookies. Use `identify` and pass `ctx.user` on explicitly.

`pnpm aws:emu` in this repo builds the example with OpenNext and invokes the Lambda handler locally through a stand-in for the streaming runtime. It checks that the response streams and that tools still read the caller's cookie.

**Cloudflare Workers (OpenNext).**

```bash
pnpm dopus infra cloudflare
```

The command writes `open-next.config.ts` (`defineCloudflareConfig`), `wrangler.jsonc` (`nodejs_compat`) and `.dev.vars`. It also adds `cf:preview` and `cf:deploy` scripts, git-ignores `.open-next`, `.dev.vars` and `.wrangler`, and installs `@opennextjs/cloudflare` and `wrangler`.

Wrangler reads `.dev.vars` instead of `.env.local`. So the command offers to copy your API key and `DOPUS_APPROVAL_SECRET` into `.dev.vars` for the local preview. The values are never printed.

For production, set the same two values with `npx wrangler secret put`.

Things to know:

- **No wall-clock limit.** A Worker can keep streaming as long as the client stays connected, and waiting on the LLM does not count as CPU time.
- **CPU time.** Rendering and tool code do count toward CPU time. Paid plans allow 30 s by default and up to 5 min with `limits.cpu_ms`. The free plan allows 10 ms per request, which a Next.js app usually exceeds.
- **Node runtime.** OpenNext runs the Node.js runtime, so remove `export const runtime = 'edge'`.

`pnpm cf:e2e` in this repo copies the example and runs `dopus infra cloudflare` on it. It then builds the copy, serves it with `wrangler dev` (local workerd) and runs the same e2e suite against it, covering cookies, ownership checks and signed approvals.

**Google Cloud Run.**

```bash
pnpm dopus infra gcp
```

The command sets `output: 'standalone'` in `next.config` (it asks first). It writes a multi-stage `Dockerfile` that pins your pnpm or yarn version through corepack. It also writes a `.dockerignore` that keeps `.env*` and `.dev.vars` out of the image.

It then prints the deploy commands: Secret Manager setup, and `gcloud run deploy --source . --timeout 3600 --set-secrets ...`.

Things to know:

- **Timeout.** A request may last up to 60 min (`--timeout 3600`; the default is 5 min). The timeout covers the whole streamed reply.
- **Longer work.** Use Cloud Run Jobs and pass the user explicitly (`identify` → `ctx.user`), because there are no cookies outside the request.
- **Build-time variables.** `.env` files are not copied into the image. If your build needs `NEXT_PUBLIC_*` values, pass them as build args.

`pnpm gcp:e2e` in this repo copies the example and runs `dopus infra gcp` on it. It builds the image with Docker and runs it the way Cloud Run does (`PORT=8080`, secrets as env vars). It checks that a canary secret from `.env.local` is not in the image, then runs the e2e suite against the container.

## Providers

| Provider  | Package             | API key env                    | Default model       |
| --------- | ------------------- | ------------------------------ | ------------------- |
| OpenAI    | `@ai-sdk/openai`    | `OPENAI_API_KEY`               | `gpt-5.5`           |
| Anthropic | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY`            | `claude-sonnet-5-5` |
| Google    | `@ai-sdk/google`    | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-3.5-flash`  |

To switch providers or models, change `model` in `agent.config.ts`. Any AI SDK model works there.

## Testing without an API key

Swap in a scripted `MockLanguageModelV4` from `ai/test` behind an environment variable. [`examples/next-app`](https://github.com/akodm/dopus/tree/main/examples/next-app) does this with `DOPUS_MOCK_MODEL=1`. Its e2e tests drive the real route through `next start` without calling any LLM.

## Status and roadmap

dopus is pre-1.0, so expect breaking changes before 1.0. It is tested on Next.js 16 with the Node.js runtime.

Planned next, within the lightweight scope above:

- tool input schemas inferred from TypeScript types.

## Development

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm example:build && pnpm example:e2e   # next start + scripted model
pnpm example:ui                          # the chat UI in Chromium (Playwright): approvals, jobs, limits
pnpm example:live                        # real model from examples/next-app/.env.local (costs cents)
pnpm smoke                               # packed tarball → fresh app → init (older release) → update → next build
pnpm templates:history                   # after changing a template: record its hash for `dopus update`
pnpm aws:emu                             # OpenNext build → local Lambda streaming invoke
pnpm cf:e2e                              # dopus infra cloudflare → wrangler dev (workerd) → e2e
pnpm gcp:e2e                             # dopus infra gcp → docker build/run (Cloud Run style) → e2e
```

Design notes: [`docs/design.md`](docs/design.md).

## License

MIT
