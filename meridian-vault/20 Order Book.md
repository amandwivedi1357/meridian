# Order Book

An order book is the exchange's live list of buy and sell interest.

## Terms

- Bid: price where someone wants to buy
- Ask: price where someone wants to sell
- Best bid: highest buy price
- Best ask: lowest sell price
- Spread: best ask minus best bid

## Meridian Implementation

Relevant files:

- `packages/binance-client/src/order-book/local-order-book.ts`
- `packages/binance-client/src/order-book/depth-sync.ts`
- `packages/binance-client/src/order-book/depth-sync-orchestrator.ts`
- `packages/binance-client/src/order-book/metrics.ts`

## Current Guarantees

- starts from REST snapshot levels
- applies bid and ask updates
- removes zero-quantity levels
- keeps bids sorted high-to-low
- keeps asks sorted low-to-high
- exposes best bid and best ask
- checks random update sequences with property tests
- uses Binance depth sequence IDs for gap detection
- triggers resync after sequence gaps

Related:

- [[21 Binance Market Data]]
- [[26 Observability]]
- [[92 Resume Story]]

