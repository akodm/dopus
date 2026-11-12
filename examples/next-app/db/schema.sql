-- Chat history for the example app when DATABASE_URL is set (see lib/chat-db.ts).
-- psql "$DATABASE_URL" -f db/schema.sql
create schema if not exists dopus;

create table if not exists dopus.chat_messages (
  -- Keyed by user too: message ids and conversationId come from the browser, so one user's ids must never
  -- reach another user's rows.
  user_id text not null,
  id text not null,
  conversation_id text not null,
  message jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Insertion order, to load a conversation in order.
  seq bigserial,
  primary key (user_id, id)
);

create index if not exists chat_messages_conversation
  on dopus.chat_messages (user_id, conversation_id, seq);

-- "New chat" closes the user's open conversations; the next message starts a new one.
create table if not exists dopus.chat_closed (
  user_id text not null,
  conversation_id text not null,
  primary key (user_id, conversation_id)
);
