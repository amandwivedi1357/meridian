# Phase 3.1 Testnet Client Verification

## Scope

The authenticated client provides HMAC/Ed25519 signing, synchronized server time,
validated MARKET/LIMIT order endpoints, a Testnet-only environment guard, and a
user-data WebSocket stream. Construction does not start network requests or an
executor. Mutating requests are never automatically retried.

The stream uses `userDataStream.subscribe.signature` on Binance's Spot Testnet
WebSocket API. It normalizes account balances, balance deltas, and execution
reports with Decimal values and commission assets. It handles subscription
acknowledgements, ping/pong deadlines, bounded reconnect backoff, and session
rotation. Authentication rejection stops the stream instead of repeatedly
submitting invalid credentials.

Reconnects and rotation can leave gaps. Consumers must reconcile before resuming
execution; automatic fill replay, deduplication, persistence, and recovery belong
to Phase 3.2. This client alone is not an unattended trading service.

## Credentials

Use Spot Testnet credentials only. Configure the ignored repo-root `.env` with
`BINANCE_ENV=testnet` and `BINANCE_API_KEY`. Configure exactly one of:

- `BINANCE_API_SECRET` for HMAC.
- `BINANCE_PRIVATE_KEY_PATH` for an Ed25519 private PEM file outside the repository.

Prefer an absolute private-key path. Do not commit credentials or private keys,
paste them into chat, or put them in command-line arguments. The library factory
accepts an injected environment and does not implicitly load `.env`; the smoke
entry point explicitly loads the repo-root file without overriding existing
process environment variables. Production is refused, with no override flag.

## Read-Only Live Check

From the repository root:

```powershell
pnpm --filter @meridian/binance-client smoke:trading BTCUSDT
```

The symbol is an argument, not a fixed runtime setting. The command synchronizes
time, reads open orders for that symbol, authenticates the user-data subscription,
and observes it for 15 seconds. It prints counts and stream state only. It does
not place or cancel orders. A quiet account can legitimately produce zero events;
this check does not prove fill delivery or long-term heartbeat stability.

This check has NOT been run against a real Testnet account. Live credential and
fill verification remain outstanding; successful mocks are not live proof.

## Local Verification (2026-10-06)

- Binance client: 269 tests across 20 files; TypeScript build and ESLint pass.
- Loopback WebSocket integration verifies the signed subscription, account event
  delivery, automatic replies to server ping frames, and clean shutdown.
- Other tests use dummy credentials and mocked transports. No real authenticated
  requests or orders were sent during this implementation.

Phase 3.1 remains open: the P1 shared `ExchangeGateway` / `MarketDataSource`
contracts and Binance/simulator adapters are not implemented yet. Finish this
subphase and its verification before moving on to Phase 3.2. Phase 3 as a whole
also requires lifecycle, executor, risk controls, and its 48-hour run criteria.
