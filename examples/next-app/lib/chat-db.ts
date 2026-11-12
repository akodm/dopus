import type { UIMessage } from 'ai'
import { Pool } from 'pg'

/**
 * Chat history in Postgres when DATABASE_URL is set (tables: db/schema.sql); otherwise each tab keeps its own in
 * sessionStorage. Every query is scoped to the signed-in user, because message ids and the conversation id come
 * from the browser.
 */
const url = process.env.DATABASE_URL

// On globalThis, like the store: one pool even if a production build loads this module twice.
const g = globalThis as unknown as { __chatPool?: Pool }
const pool = () => {
  g.__chatPool ??= new Pool({ connectionString: url, max: 5 })
  return g.__chatPool
}

export const chatDb = url
  ? {
      /** Upsert by id: after an approval the same assistant message arrives again, continued. */
      async save(userId: string, conversationId: string, messages: UIMessage[]) {
        for (const message of messages) {
          await pool().query(
            `insert into dopus.chat_messages (user_id, id, conversation_id, message)
             values ($1, $2, $3, $4)
             on conflict (user_id, id) do update set message = excluded.message, updated_at = now()
             where dopus.chat_messages.conversation_id = excluded.conversation_id`,
            [userId, message.id, conversationId, JSON.stringify(message)],
          )
        }
      },

      /** The user's latest conversation that "New chat" has not closed. */
      async load(userId: string): Promise<UIMessage[]> {
        const { rows } = await pool().query<{ message: UIMessage }>(
          `select message from dopus.chat_messages
           where user_id = $1 and conversation_id = (
             select m.conversation_id from dopus.chat_messages m
             where m.user_id = $1 and not exists (
               select 1 from dopus.chat_closed c
               where c.user_id = $1 and c.conversation_id = m.conversation_id)
             order by m.seq desc limit 1)
           order by seq`,
          [userId],
        )
        return rows.map((row) => row.message)
      },

      /** "New chat": keep the old conversations, but do not load them again. */
      async close(userId: string) {
        await pool().query(
          `insert into dopus.chat_closed (user_id, conversation_id)
           select distinct user_id, conversation_id from dopus.chat_messages where user_id = $1
           on conflict do nothing`,
          [userId],
        )
      },
    }
  : undefined
