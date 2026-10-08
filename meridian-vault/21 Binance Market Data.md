# Binance Market Data

Meridian currently uses public Binance Spot market data.

## REST

Used for:

- server time
- exchange info
- depth snapshot
- klines

Relevant folder:

- `packages/binance-client/src/rest`

## WebSocket Streams

Used for:

- trades
- klines
- depth updates

Relevant folder:

- `packages/binance-client/src/streams`

## Important Rule

Money and quantities should use `Decimal`, not `parseFloat`.

Related:

- [[20 Order Book]]
- [[22 Redis Streams]]

