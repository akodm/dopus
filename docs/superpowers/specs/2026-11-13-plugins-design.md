# Chat UI as a package, with plugins — design

Date: 2026-11-13. Status: for approval. Builder check done; its five questions are settled below as calls.

## Intent

Today the chat UI is one fixed file that `dopus init` copies into the app (`components/agent/agent-chat.tsx`, ~600
lines) plus `agent-chat.css`. Tool status lines and approval cards are built in, and there is no way to attach a file.
The owner finds this "fixed and decided for you". They want:

- The chat to be assembled from parts the app chooses: the parts that show tool activity, ask for approval, and
  attach files are **plugins**, none of them on by default, imported from `dopus/plugins` and attached or removed
  freely.
- File attachments, so an agent in an ERP or admin screen can be handed a spreadsheet (or an image) to tidy up or
  analyse with the app's tools.
- UI that is easy to restyle: one CSS file generated into the app with every class dopus uses, grouped and commented
  by area (floating button, message styles, message box, buttons, each plugin).
- A README guide for each plugin, since they are near-essential in practice.

Decided with the owner: **approach A** (below) — the chat shell moves into the package too.

## Goals

1. `dopus/react` exports the chat shell: `AgentChat` and `AgentWidget`, with a `plugins` prop.
2. `dopus/plugins` exports three plugins: `toolLog()`, `approvals()`, `attachments()`.
3. Without plugins the chat still works for plain conversation, background jobs and history.
4. The app's CSS file covers the shell and all three plugins, organised in commented sections.
5. Apps can write their own plugin against the same interface (the way to change markup now that the shell is not
   copied).
6. `dopus init` and `dopus update` produce and migrate to the new layout.
7. README documents the shell, each plugin, custom plugins, and the CSS sections.

## Non-goals

- No visual redesign: same look, same class names where an element stays.
- No spreadsheet engine in dopus. Reading or querying a file is the app's tool (README recipe only).
- No upload endpoint or storage in dopus: the app's `upload` function stores files.
- No sending file bytes to the model in this version (images/PDF read by the model directly). The file reference
  design leaves room for it; see Later.
- No theming system beyond CSS variables that exist today.

## Anti-goals (would make this a failure even if it works)

- A plugin system so abstract that a simple app needs more code than today. A typical setup stays a few lines.
- A missing approvals plugin silently breaking `confirm: true` tools (cards that never appear, a chat that hangs).
- The server trusting anything the browser says about plugins or files for security.
- Existing 0.2.x apps broken by `pnpm add dopus@latest` without a clear path.

## Constraints

- Next.js App Router, React 19, AI SDK 7 (`@ai-sdk/react` `useChat`), as today.
- The server entry (`dopus`) must stay free of React; the CLI stays Node-only.
- Client entries must be usable from a client component: the built files keep a `'use client'` directive at the top.
- Plugins hold functions (render, upload), so they are created in a client component, like `channel` and `history`
  today.
- Keep the behaviour the current UI has and the browser tests check: approve/decline, approve-all, stale cards
  "Not run", server-closed cards "Not run", `router.refresh()` after a tool ran, background job follow-ups and cap,
  unread launcher dot, history load/save, 413 → new chat, stop/retry, IME-safe Enter, Markdown with safe links.

## Approaches considered

- **A. Shell and plugins in the package (chosen).** `dopus/react` + `dopus/plugins`; the app keeps a thin wrapper
  component and the CSS file. Updates arrive with npm; customisation is CSS, labels, plugin options, and custom
  plugins. Chosen because it matches the plugin idea and removes template drift (the copied 600-line file going
  stale between releases).
- **B. Shell stays a copied template, plugins from the package.** Full freedom to edit the shell, but the copy and
  the package must agree on the plugin interface every release; a skipped `dopus update` breaks the chat. Rejected
  for that coupling.
- Plugins as copied templates too: rejected; the owner wants them imported from `dopus/plugins`.

## Design

### Package entries

| Entry           | Contents                                                                                                               | Runs                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `dopus`         | unchanged server API (`defineAgent`, `defineTool`, `createAgentHandler`, …) + server handling of file parts            | server                  |
| `dopus/react`   | `AgentChat`, `AgentWidget`, plugin types, `definePlugin` helper, `AgentChannel`, `AgentChatHistory`, `AgentChatLabels` | client (`'use client'`) |
| `dopus/plugins` | `toolLog`, `approvals`, `attachments`                                                                                  | client (`'use client'`) |

`react`, `react-dom`, `@ai-sdk/react`, `next`, `react-markdown`, `remark-gfm` become **optional** peer dependencies
(needed only by the client entries). `init` installs them as it does today.

### The app's files after `dopus init`

```
app/api/agent/route.ts           (unchanged)
agent.config.ts                  (unchanged)
agent/prompts/preset.ts          (unchanged)
components/agent/agent-chat.tsx  thin client wrapper (same path and export names as today; ~20 lines instead of ~600)
components/agent/agent-chat.css  every dopus class, sectioned (regenerated layout)
```

```tsx
// components/agent/agent-chat.tsx — generated by dopus init; yours to edit
'use client'
import { AgentChat as Chat, type AgentChatProps, AgentWidget as Widget } from 'dopus/react'
import { approvals, toolLog } from 'dopus/plugins'
import './agent-chat.css'

export type { AgentChannel, AgentChatHistory, AgentChatLabels, AgentChatProps } from 'dopus/react'

// Plugins are optional. Remove a line to drop that part of the chat; see the README.
const plugins = [toolLog(), approvals()]

export function AgentChat(props: AgentChatProps) {
  return <Chat plugins={plugins} {...props} />
}

export function AgentWidget(props: AgentChatProps) {
  return <Widget plugins={plugins} {...props} />
}
```

Call (from the builder check): the wrapper keeps the old path and the names `AgentChat` / `AgentWidget`, and
re-exports the types. Today `init` does not edit `app/layout.tsx` (it prints the line to add), and apps' own wrappers
(the README's and the example's `agent.tsx` with `channel` and `history`) import from `./agent-chat`. Keeping the
path and names means neither the layout nor those wrappers change, and `update` never has to edit a file the app
owns other than this one.

Call: the generated wrapper lists `toolLog()` and `approvals()` so a fresh install shows tool activity and can approve
`confirm` tools out of the box; `attachments()` is left out because it needs the app's `upload`. "Not on by default"
means the shell has none built in; the starter file opts in, visibly, one line each.

### The shell (`dopus/react`)

`AgentChat` keeps today's props (`api`, `labels`, `suggestions`, `className`, `channel`, `maxJobFollowUps`,
`onReply`, `history`) and adds `plugins?: ChatPlugin[]`. `AgentWidget` wraps it as today (launcher, panel, unread).

The shell owns: transport and `useChat`, header and "New chat", message list and scrolling, user and assistant text
(Markdown, safe links), suggestions, thinking indicator, error and 413 handling, composer (textarea, send/stop,
IME-safe Enter), history load/save, background job tracking and follow-ups (the mechanism, and the "Background task
finished" notice), `router.refresh()` after a tool ran, the launcher.

The shell does not render tool parts itself. A tool part no plugin renders is not shown.

### Plugin interface

A plugin is a plain object; the factories in `dopus/plugins` return one. `definePlugin` only types it.

```ts
interface ChatPlugin {
  name: string
  /** Render a message part (tool parts, data parts). Return undefined to leave it to the next plugin. */
  renderPart?: (part: UIMessagePart, ctx: PartContext) => ReactNode | undefined
  /** Below the message list, above the composer (e.g. "Approve all"). */
  renderFooter?: (ctx: ChatContext) => ReactNode
  /** Inside the composer, next to the send button (e.g. the attach button and file chips). */
  renderComposer?: (ctx: ComposerContext) => ReactNode
  /** Add parts to the user's message before it is sent (e.g. file references). May block sending. */
  beforeSend?: (
    draft: { text: string; parts: UIMessagePart[] },
    ctx: ChatContext,
  ) => void | Promise<void>
  /** What the server may rely on this client to show. See "Telling the server which plugins are there". */
  capabilities?: { approvals?: boolean }
}
```

Contexts give plugins what they need and nothing more: the message and whether it is the newest (`stale`), the
waiting job IDs, `respondToApproval(id, approved)`, open approval IDs, `busy`, the merged labels, and for the composer
the draft state API the attachments plugin needs (add/remove pending files, mark uploading so Send waits). Exact field
names are the builder's.

Plugins are tried in array order; the first `renderPart` that returns something wins, so an app can put its own
plugin first to override one part (e.g. a custom card for `deleteUser`) and keep the stock plugin for the rest.

Labels stay in one place: the shell's `labels` prop keeps every key it has today (tool and approval strings
included), and plugins read the merged labels from their context. Each plugin's default strings are part of the
shell's defaults; a plugin may also take a `labels` option, which wins for that plugin. So
`<AgentWidget labels={{ approve: '승인' }} />` keeps working (call, from the builder check: the README pitches
`labels` for translation and layouts pass it straight through).

### `toolLog()`

Renders tool parts that are not waiting for approval: running (spinner), done (✓ with collapsible input/output),
failed (✗), declined, not run (stale cards and cards the server closed), and "Working in the background" for a job
tool whose job has not finished. Today's markup and classes.

Options: `labels`, `details: boolean` (show the collapsible JSON; default true), `hide?: string[]` (tool names not to
show), `title?: (toolName) => string` (default: today's humanize).

### `approvals()`

Renders tool parts in `approval-requested` (the card with input, Approve, Decline) and `approval-responded` (Approved /
Declined line while the request is in flight), plus the "Approve all (n) / Decline all" footer when the newest message
has more than one open card. Declares `capabilities: { approvals: true }`.

Options: `labels`, `approveAll: boolean` (default true), `describe?: (toolName, input) => ReactNode` (custom body of
the card instead of the JSON).

When both plugins are present the split is: `approvals` owns `approval-requested` and `approval-responded`;
`toolLog` owns every other state, including `output-denied` after an approval.

### Telling the server which plugins are there

Without `approvals()`, a `confirm: true` tool could be called but never approved. So the shell sends, with every
request, the union of its plugins' capabilities: `{ dopus: { approvals: true } }` in the request body, next to today's
`context`.

Server rule (three cases):

- `dopus.approvals: true` — confirm tools are offered (today's behaviour).
- a `dopus` field without `approvals: true` — the shell is there and has no approvals plugin: every tool with
  `confirm` (a boolean or a function) is left out of the offered tools, exactly like tools hidden by `access` (not
  offered, no note, not counted for the signed-out note), and an open or approved card for one in the last message
  is settled as not run.
- no `dopus` field at all — a client that predates this (0.2.x copies, custom `useChat` UIs, tests posting directly):
  treated as `approvals: true`, so nothing that works today breaks. Permanent, not a transition period.

Calls (from the builder check): a function `confirm` hides the tool too, rather than settling only the calls that
would need approval; simpler, and an app without approval UI should not get approval-gated tools at all. The
missing-field case is permanent because the anti-goal forbids breaking 0.2.x apps and a deprecation adds code for
little gain. `defineAgent` cannot know the client, so there is no startup warning; the README's plugin table says it.

This is a visibility hint, not security: a client that claims `approvals: true` only gets cards; the approval itself
is still required and signed (`approvalSecret`) by the server as today. A client that omits it only hides tools from
itself.

A custom UI built on `useChat` that wants to say "no approval UI here" sends `dopus: {}`.

### `attachments({ upload, … })`

Client:

- An attach button in the composer (`<input type="file">`, multiple), chips for pending files with name, size,
  progress/error, and remove.
- Each picked file goes to the app's `upload(file, { signal }) => Promise<{ id: string; name?: string; type?: string;
  size?: number }>`. Send is disabled while an upload runs; a failed upload shows an error on its chip and is not sent.
- On send, each uploaded file becomes a part of the user's message: `{ type: 'data-dopus-file', data: { id, name,
  type, size } }`. File bytes never go through `/api/agent`.
- Options: `upload` (required), `accept?: string`, `maxFiles?: number` (default 5), `maxSize?: number` (bytes, checked
  before upload; default 20 MB), `labels`.
- The shell shows file parts in sent messages as chips (shell renders `data-dopus-file` read-only, so history and
  other tabs show them even without the plugin).

Server (in `dopus`, no plugin import needed):

- Accepts `data-dopus-file` parts on user messages: validates shape (`id` string ≤ 200 chars, `name` ≤ 255, `type` ≤
  100, `size` number), at most 10 per message; otherwise 400, like other invalid messages.
- Turns each into text the model sees, written by the server: `The user attached a file: "<name>" (<type>, <size>),
  fileId "<id>". Read it with a tool that takes the fileId; you cannot see its contents otherwise.`
- The file's owner check is the app's: the tool receiving `fileId` checks that the file belongs to the signed-in user.
  The README says so; the browser chose the id.

README recipe (not in the package): spreadsheet tools `inspectSpreadsheet(fileId)` (sheets, columns, types, row
count, a few sample rows) and `querySpreadsheet(fileId, sql)` (read-only, e.g. DuckDB), and a `previewImport` /
`importX` pair with `confirm: true` for writing into the ERP.

### CSS file

`components/agent/agent-chat.css`, still plain global CSS with `dopus-` classes and `--dopus-*` variables, rewritten
into sections, each with a header comment listing its classes and what they style:

1. Theme variables (light, dark)
2. Floating button (launcher, unread dot) and panel
3. Chat frame and header ("New chat")
4. Message list, message boxes (user, assistant), notices
5. Assistant text (Markdown: lists, code, tables, links)
6. Composer (textarea, send/stop)
7. Buttons and links (primary, secondary, link)
8. Status (thinking, error, suggestions, spinner)
9. Plugin: tool log
10. Plugin: approvals
11. Plugin: attachments (attach button, chips, sent file chips)

Plugins only use classes from this file; a plugin left out just leaves its section unused. `dopus update` keeps
updating this file with the template history mechanism (untouched copies replaced, edited copies get a `.new`).

### `dopus init` and `dopus update`

- `init` writes the thin `agent-chat.tsx` and the CSS, installs the client peers, and prints the layout line, as today.
- `update` on a 0.2.x app (has the ~600-line `components/agent/agent-chat.tsx`):
  - untouched copy (recognised by template history): replace it with the thin wrapper (with `toolLog()` and
    `approvals()`, what the old UI showed). Same path and exports, so the layout and the app's own wrappers keep
    building. Say what it did.
  - edited copy: leave it; it is self-contained and keeps working (it sends no `dopus` field, so its confirm tools
    stay offered). Write the thin wrapper next to it as `agent-chat.tsx.new` (the existing `.new` convention) and print
    the steps.
  - The app's own wrappers are not touched.
- The thin wrapper is itself a template tracked by template history from 0.3.0 on.

### Version

0.3.0: new entries and a request-body behaviour change.

### Example app, demo, tests

- `examples/next-app` moves to the thin `agent-chat.tsx` (its own `agent.tsx` with `channel` and `history` stays as is),
  adds an
  attachments demo with an in-memory `upload` route and a `describeFile(fileId)` tool that checks the owner.
- All existing browser tests (14, plus 5 DB tests) keep passing against the package UI.
- New tests: no `approvals()` → confirm tools not offered and no card; no `toolLog()` → no tool lines; plugin order
  override; attachments: upload, chip, send, server text the model sees, invalid file parts → 400, foreign `fileId`
  refused by the example tool; CSS file contains every class the package renders (a test that scans built output
  for `dopus-` classes and checks each is in the CSS).
- Demo (`~/Workspace/dopus-demo`) migrated with `dopus update`.

## Left to the builder

- Exact context field names, internal file layout of `dopus/react`, how `'use client'` is kept in the build (tsdown
  banner or per-entry).
- Markup details inside plugins as long as class names stay and tests pass.
- Upload progress UI details.

## Later

- Images and PDFs read by the model directly: an optional server `resolveFile(fileId, user)` that returns a URL or
  bytes, turned into a model file part.
- More plugins (feedback buttons, copy message, citations).
