/** In-memory data for the example. Resets when the server restarts. */
export interface Order {
  id: string
  owner: string
  item: string
  status: 'open' | 'shipped' | 'cancelled'
}

const orders: Order[] = [
  { id: 'o-1', owner: 'alice', item: 'Keyboard', status: 'open' },
  { id: 'o-2', owner: 'alice', item: 'Monitor arm', status: 'shipped' },
  { id: 'o-3', owner: 'bob', item: 'Desk lamp', status: 'open' },
]

export const store = {
  ordersOf: (owner: string) => orders.filter((order) => order.owner === owner),
  find: (id: string) => orders.find((order) => order.id === id),
}
