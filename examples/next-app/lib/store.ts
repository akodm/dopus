/** In-memory data for the example. Resets when the server restarts. */
export interface Order {
  id: string
  owner: string
  item: string
  status: 'open' | 'shipped' | 'cancelled'
}

const seed = (): Order[] => [
  { id: 'o-1', owner: 'alice', item: 'Keyboard', status: 'open' },
  { id: 'o-2', owner: 'alice', item: 'Monitor arm', status: 'shipped' },
  { id: 'o-3', owner: 'bob', item: 'Desk lamp', status: 'open' },
  // Used by the browser tests (test/ui), so the API tests above keep their own data.
  { id: 'o-4', owner: 'carol', item: 'Mouse', status: 'open' },
  { id: 'o-5', owner: 'carol', item: 'Webcam', status: 'open' },
  { id: 'o-6', owner: 'carol', item: 'Headset', status: 'open' },
  // Used by the several-tabs browser tests (test/ui/tabs.spec.ts).
  { id: 'o-7', owner: 'erin', item: 'Charger', status: 'open' },
  { id: 'o-8', owner: 'erin', item: 'Cable', status: 'open' },
  { id: 'o-9', owner: 'erin', item: 'Stand', status: 'open' },
]

// On globalThis: a production build can load this module once for the pages and again for the agent route,
// and module-level state would then differ between them. (A real app keeps this in its database.)
const g = globalThis as unknown as { __orders?: Order[] }
g.__orders ??= seed()
const orders = g.__orders

export const store = {
  ordersOf: (owner: string) => orders.filter((order) => order.owner === owner),
  all: () => orders,
  find: (id: string) => orders.find((order) => order.id === id),
}
