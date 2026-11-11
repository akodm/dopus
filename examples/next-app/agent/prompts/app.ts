/**
 * Layer 3 — App context. Copied by `dopus init`; this file is yours to edit.
 */
const appPrompt = `Service: dopus example shop — a tiny store used to demonstrate dopus.
Users: signed-in customers (alice or bob) checking and cancelling their orders.
Key concepts: an order has an id like "o-1", an item and a status (open, shipped, cancelled). Only open orders can be cancelled.
Human help: this is a demo; there is no human support.`

export default appPrompt

/** Optional notes per language (tone, terminology). The one matching the request locale is used. */
export const locales: Record<string, string> = {
  ko: '존댓말을 사용하세요. "주문"은 order, "취소"는 cancel입니다.',
}
