# dopus recipes

Patterns built from the parts in the [README](../README.md): a tool is your server function, so each of these is
mostly your own code.

## Search your documents (RAG)

Retrieval is a tool. Write a server function that searches your vector store and register it like any other:

```ts
// agent.config.ts
import { defineTool } from 'dopus'
import { z } from 'zod'
import { searchDocs } from './app/actions/docs' // your own server function

// in `tools: { ... }`
searchDocs: defineTool((input) => searchDocs(input.query), {
  description: 'Searches the help articles and returns the best matching passages with their source.',
  usage: 'When the user asks how something works or what a policy says. Cite the title and url in the answer.',
  input: z.object({ query: z.string() }),
  output: (result) => result.map(({ title, url, passage }) => ({ title, url, passage })),
}),
```

```ts
// app/actions/docs.ts
'use server'
import { ToolError } from 'dopus'

// getSession, db and embed are your app's own session, database client and embedding call.
export async function searchDocs(query: string) {
  const session = await getSession()
  if (!session) throw new ToolError('Sign in to search the documents.')
  // The permission filter is part of the query, with the session's org, so a passage the user may not read is never
  // retrieved. Do not filter the results afterwards, and never take the org from the model's input.
  return db.query(
    `select title, url, passage from chunks where org_id = $1 order by embedding <=> $2 limit 5`,
    [session.orgId, await embed(query)],
  )
}
```

- **The filter goes inside the search query.** The function runs with the caller's cookie, so it knows the user. Anything
  the model can pass in (`query`, a filter argument) is only a request.
- **Trim with `output`.** Send the model the passages and not the embeddings, scores or internal ids. Keep `limit`
  small; the results count against the history on every later step.
- **Return `title` and `url`** so the model can cite its sources, and say so in `usage`.
- **Retrieved text is untrusted input.** A document may contain instructions. Tools that write keep `confirm: true`, so
  an injected "delete the account" still stops at the approval card. See [Permissions and security](../README.md#permissions-and-security).
- **There is no "retrieve on every turn" hook.** The `runtime` layer does not receive the messages, so dopus cannot
  search for the user's question before the model answers. The tool is the supported way: the model decides when to
  search, and the tool line in the chat shows it did.

## Attached files

**Spreadsheets.** For an upload that becomes data, split the work in tools so the model never has to read a whole
file, and so the write is a step the user approves:

- `inspectSpreadsheet(fileId)`: sheet names, headers, row count and a few sample rows;
- `querySpreadsheet(fileId, sheet, filter, limit)`: rows that match, capped (use `output` to trim);
- `previewImport(fileId, mapping)`: validates the rows against your schema and returns what would change, writing nothing;
- `importOrders(fileId, mapping)` (your own name): does the import, with `confirm: true`, so the user sees the
  mapping and the counts before anything is written.

Every one of them checks the file's owner first.

**Images and PDFs.** Let a tool read the file and return text; do not put the file itself in the conversation. dopus
sends the whole history to the model on every step, so a 20-page PDF in a message is paid for again on every later
question, and big bodies hit request size limits. A tool's answer stays a few hundred tokens:

```ts
// agent.config.ts
readDocument: defineTool((input) => readDocument(input.fileId, input.question), {
  description: 'Reads an attached image or PDF and answers a question about it.',
  usage: 'When the user attaches an image or a PDF. Pass what they want to know, e.g. "the termination clauses".',
  input: z.object({ fileId: z.string(), question: z.string() }),
}),
```

```ts
// app/actions/documents.ts
'use server'
import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { ToolError } from 'dopus'

// getSession and files are your app's own session and file storage.
export async function readDocument(fileId: string, question: string) {
  const session = await getSession()
  if (!session) throw new ToolError('Sign in to read files.')
  const file = await files.find(fileId)
  if (!file || file.ownerId !== session.userId) throw new ToolError('File not found.')
  if (!/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(file.type)) {
    throw new ToolError('Only images and PDFs can be read.')
  }
  // One model call that sees the file. Any model that reads images and PDFs works; a small one is usually enough.
  const { text } = await generateText({
    model: anthropic('claude-haiku-5-5'),
    maxOutputTokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: file.bytes, mediaType: file.type },
          {
            type: 'text',
            text: `Answer from this file only, briefly, quoting where it matters: ${question}`,
          },
        ],
      },
    ],
  })
  return { name: file.name, answer: text }
}
```

- **The question goes to the tool**, so it reads only what is needed, and a second question about the same file is
  another short call instead of the whole file again.
- **The file's text is untrusted input**, like a retrieved passage: tools that write keep `confirm: true`.
- **Your own limits apply here**: page count, file size, or an OCR service instead of a model. They are your code.

**Large files.** A scanned contract of 80 pages, or a batch of invoices, can take longer than a request. Make reading
it a [background job](../README.md#background-jobs): `startDocumentRead(fileId, question)` hands the file to your worker with
`job: (result) => result.jobId` and returns at once; the worker saves the answer; your channel rings; the agent reads
it with `getDocumentRead(jobId)` (which checks the owner) and carries on.

## Through an AI gateway

A gateway (Cloudflare AI Gateway, for example) sits between your app and the provider: one place for cost dashboards,
logs, fallbacks and retries. Point the provider at it; dopus needs nothing else:

```ts
// agent.config.ts
import { createAnthropic } from '@ai-sdk/anthropic'

const anthropic = createAnthropic({
  baseURL: `https://gateway.ai.cloudflare.com/v1/${process.env.CF_ACCOUNT_ID}/${process.env.CF_GATEWAY_ID}/anthropic/v1`,
  headers: { 'cf-aig-authorization': `Bearer ${process.env.CF_AIG_TOKEN}` }, // for an authenticated gateway
})

export default defineAgent({
  model: anthropic('claude-sonnet-5-5'),
  // A function runs per request, so the gateway's log can say whose request it was.
  callOptions: (request, { user }) => ({
    headers: { 'cf-aig-metadata': JSON.stringify({ userId: user?.id ?? 'anonymous' }) },
  }),
  // ...
})
```

`callOptions` as a function gets the request and the user from `identify`, and runs after `beforeRequest`. Per-user
limits still belong in `beforeRequest` (a gateway's rate limit counts the whole gateway), and `onFinish` still reports
each user's tokens. A gateway's response cache rarely helps a chat, since every request carries a different history.
