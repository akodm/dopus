# Upgrading dopus

After `pnpm add dopus@latest`, run `pnpm dopus update` (see "Updating" in the [README](../README.md)), then check
the notes for each version you skipped. The [changelog](../CHANGELOG.md) lists every change.

## Upgrading to 0.6

- **`dopus infra` is gone.** The files it wrote (`open-next.config.ts`, `wrangler.jsonc`, `Dockerfile`, ...) stay in
  your project and keep working; nothing generates or updates them anymore. Host the app as you already do; the
  README's "Hosting" lists what the agent route needs.
- **Channels.** `subscribe` now also gets `{ waiting }`, the job IDs the chat is waiting for. Existing channels ignore
  it and keep working. A hand-written SSE or polling channel can be replaced by `sseChannel(url)` or
  `pollingChannel(url)` from `dopus/react`.

## Upgrading to 0.5

0.5 changes security defaults. Check these after upgrading:

- **`DOPUS_APPROVAL_SECRET` must be set** wherever the agent runs, if any tool has `confirm`; otherwise every request
  gets a 500. `dopus init` put it in `.env.local`; copy it to your hosting's environment (or set `approvalSecret`).
- **Only same-origin JSON requests reach the route.** The chat UI already sends them. If you post to `/api/agent` from
  another origin, add it to `allowedOrigins`; if you call it from scripts, send `content-type: application/json`.
- **Approvals expire and belong to one user.** A card answered after `approvalMaxAge` (600 seconds) or from another
  user's session is not run. Cards that were open while you deployed (signed by 0.4) show "Not run" when answered;
  the model asks again.
- **"Approve all" is off.** Pass `approvals({ approveAll: true })` to bring it back.

## Upgrading from 0.2

Until 0.3 the whole chat UI was in `agent-chat.tsx` (several hundred lines). Now it is in the package, and `dopus update`
moves your copy over:

- **An untouched 0.2.x copy** is replaced by the thin wrapper above (`toolLog()` and `approvals()`, which is what the
  old UI showed). It has the same path and exports (`AgentChat`, `AgentWidget`, the types), so your layout and your own
  wrappers keep building. `agent-chat.css` is updated the same way.
- **An edited copy** is left as it is, and the wrapper is written next to it as `agent-chat.tsx.new`. The old file is
  self-contained and keeps working. Merge when you want the plugins: move your changes into CSS, `labels`, plugin
  options or a plugin of your own.
- Your own wrappers around the chat (such as `agent.tsx` with `channel` and `history`) are not touched.

A custom client built on `useChat` that sends a `dopus` field (for example `dopus: {}`) without `approvals: true` no
longer gets `confirm` tools. Send `dopus: { approvals: true }` if your client shows approval cards. A client that sends
no `dopus` field is unchanged.
