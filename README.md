# dopus

Drop an AI agent into your existing Next.js app. Your server functions become its tools.

```bash
pnpm add dopus
pnpm dopus init
```

- **Reuse what you have.** Register the server actions and functions your app already has. You don't write a second API for the agent.
- **Permissions come for free.** Tools run inside the agent's request, so `cookies()` and `headers()` in your server functions see the signed-in user. Your own auth and ownership checks keep working unchanged.
- **Writes wait for the user.** Mark a tool `confirm: true` and the user approves each call in the chat. Approvals are signed so a client cannot forge one.
- **You own the generated code.** `init` copies the route, prompts and chat UI into your project, shadcn-style. Only the runtime lives in the package.

Built on the [Vercel AI SDK](https://ai-sdk.dev) 7. Supports OpenAI, Anthropic and Google models.

---

## Quick start

Requirements: Next.js App Router, TypeScript, Node.js 22+, zod 4.

```bash
pnpm add dopus        # or npm / yarn / bun
pnpm dopus init
```

`init` asks for a provider, an API key and a prompt preset, then:

| Writes                                              | What it is                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.env.local`                                        | Your API key and a generated `DOPUS_APPROVAL_SECRET`. Never `.env`. Mode 600. |
| `agent.config.ts`                                   | Model, tools and prompt layers. Edit this.                                    |
| `agent/prompts/preset.ts`, `agent/prompts/app.ts`   | Your prompt layers. Yours to edit.                                            |
| `app/api/agent/route.ts`                            | `POST /api/agent`. It speaks the AI SDK `useChat` protocol.                   |
| `components/agent/agent-chat.tsx` (+ `.module.css`) | Chat panel and floating widget.                                               |

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

### Errors

Only two kinds of error message reach the model:

- a `ToolError` you throw on purpose, such as `throw new ToolError('Order o-1 has already shipped')`;
- Next.js `redirect()`, `notFound()`, `forbidden()` and `unauthorized()`, which are translated into plain messages such as "the user is not signed in".

Any other error goes to `onError` and is replaced with a generic message, so database errors and stack details stay on the server. The browser only ever sees a generic error text.

## Permissions and security

**How permission inheritance works.** `createAgentHandler` runs the whole tool loop inside the `POST /api/agent` request. A server function called as a tool therefore sees that request's cookies and headers, just as it does when your own UI calls it. The repo's end-to-end test checks this on a real `next start` server. It confirms that tools read the caller's session cookie, return only the caller's data, and still apply the app's ownership check after an approval.

**What stays your job.**

- Authorize inside your server functions, as you already should. dopus does not add permissions; it inherits yours.
- Treat the agent like any other client. A user can only make it do what that user could already do through your server functions.
- Register only the functions you want the agent to call.
- Protect the route like your other API routes, with rate limits and auth if anonymous use costs you money.

**Approvals.** With `DOPUS_APPROVAL_SECRET` set (`init` generates it), every approval request is HMAC-signed. An approval with a missing or tampered signature is rejected and the tool does not run.

**Browser context is untrusted.** The chat UI sends `{ page, locale }` so the agent knows where the user is. The server accepts only those two keys, strips control characters and caps their length. Anything that matters for authorization, such as role, plan or tenant, must come from the server via `runtime`.

**Running tools outside the request.** Background jobs and queues lose the request's cookies. For that case, define `identify(request)` to resolve a serialisable user. Tools then receive it as `ctx.user` and can pass it on explicitly. Infra adapters that run tools elsewhere will build on this.

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

Both accept `api`, `suggestions`, `labels` (every UI string, for translation) and `className`.

The UI shows each tool call as it runs. It renders an approve/decline card for confirmed tools and continues automatically once the user answers. It also has stop and retry buttons, and it does not send on Enter while an IME (Korean, Japanese, Chinese) is still composing.

Styling is a plain CSS module themed through `--dopus-*` variables, with dark mode included. It needs no Tailwind and no component library. The file is yours, so restyle it or swap in your own components.

## Configuration

```ts
defineAgent({
  model, // any AI SDK LanguageModel, e.g. openai('gpt-5.5')
  tools, // { name: defineTool(...) }; names match [a-zA-Z0-9_-]{1,64}
  prompt: { core, preset, app, locales },
  runtime: async (request, { user, client }) => ({ role: 'admin' }),
  identify: async (request) => ({ id: 'user-1' }), // optional
  maxSteps: 10, // model ↔ tool round trips per request
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

## Deploying

**Vercel / any Node server.** Nothing extra. The route streams. Raise `maxDuration` in `app/api/agent/route.ts` if your plan allows it.

**AWS (OpenNext / SST).**

```bash
pnpm dopus infra aws
```

The command writes `open-next.config.ts` with Lambda response streaming (`aws-lambda-streaming`) and installs `@opennextjs/aws`. It also prints an `sst.aws.Nextjs` snippet that passes your API key and `DOPUS_APPROVAL_SECRET` as SST secrets.

SST reads OpenNext's streaming flag and sets the Function URL to `RESPONSE_STREAM`. Nothing is deployed for you.

Things to know:

- **Keep-alive.** While a tool runs and nothing else is sent, dopus writes an SSE comment (`: keep-alive`) every 15 s (`keepAlive` option). Clients ignore it. CloudFront, ALB and nginx time out on gaps between packets, not on total time, so a slow tool does not cut the stream.
- **Turn length.** A turn still has to finish within the Lambda timeout. Behind CloudFront that is 60 s by default (up to 180 s with a quota increase). A bare Function URL allows up to 15 min.
- **No API Gateway.** Don't put API Gateway HTTP APIs in front of `/api/agent`. They cap requests at 30 s and buffer the response.
- **Long-running work.** Work that outlives a request, such as queues and background jobs, loses the request's cookies. Use `identify` and pass `ctx.user` on explicitly.

`pnpm aws:emu` in this repo builds the example with OpenNext and invokes the Lambda handler locally through a stand-in for the streaming runtime. It checks that the response streams and that tools still read the caller's cookie.

Cloudflare and GCP adapters are planned.

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

dopus is at 0.1, so expect breaking changes before 1.0. It is tested on Next.js 16 with the Node.js runtime.

Planned next:

- infra adapters for Cloudflare and GCP (AWS is available via `dopus infra aws`);
- `dopus prompts diff` to compare your copies with newer templates;
- tool input schemas inferred from TypeScript types.

## Development

```bash
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm example:build && pnpm example:e2e   # next start + scripted model
pnpm smoke                               # packed tarball → fresh app → dopus init → next build
pnpm aws:emu                             # OpenNext build → local Lambda streaming invoke
```

Design notes: [`docs/design.md`](docs/design.md).

## License

MIT
