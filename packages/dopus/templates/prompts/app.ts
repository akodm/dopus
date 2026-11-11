/**
 * Layer 3 — App context. Copied by `dopus init`; this file is yours to edit.
 *
 * Describe your service so the agent understands your users' requests. Write it once, in one language;
 * the agent replies in the user's language automatically (see `locales` for per-language notes).
 * Keep it stable: it is part of the cached prompt prefix, so per-request values belong in `runtime`
 * in agent.config.ts instead.
 */
const appPrompt = `Service: <name> — <what it does, in one sentence>
Users: <who uses it and what they usually come to do>
Key concepts: <the nouns your users use, e.g. "workspace", "order", "plan", and what they mean>
Rules: <anything the agent must know, e.g. refund policy, business hours>
Human help: <how users reach a person, e.g. support@example.com or the Help page>`

export default appPrompt

/** Optional notes per language (tone, terminology). The one matching the request locale is used. */
export const locales: Record<string, string> = {
  // ko: '존댓말을 사용하고, "주문"과 "발주"를 구분해서 쓰세요.',
}
