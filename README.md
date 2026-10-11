# Meridian

Meridian is an event-driven algorithmic trading platform for Binance Spot market data and Binance Spot Testnet execution.

The current prototype includes ingestion, backtesting, bounded Testnet execution and an authenticated live dashboard. Phase 4 API/dashboard implementation and local acceptance are complete; earlier long-run gates and production hardening remain pending. See `docs/current-state.md` for evidence and limitations.

The UI has seven dedicated workspaces: Overview, Market, Trading, Risk, Strategies, Backtests and System, selected from the left icon rail. Operational data stays live through shared SSE; unreported worker/strategy telemetry is explicitly unavailable. Trading has no manual order-placement form, and operator stop/resume controls require explicit confirmation.

## Quickstart

```bash
pnpm install
pnpm typecheck
pnpm test
docker compose -f infra/docker-compose.yml up
```

## Workspace

- `apps/ingestor`: Binance stream ingestion
- `apps/engine`: strategy runtime
- `apps/executor`: risk and order execution
- `apps/backtest-worker`: queued backtests
- `apps/api`: Fastify API gateway
- `apps/web`: React dashboard
- `apps/mcp-server`: MCP tools for AI agents
- `packages/core`: domain model and strategy SDK
- `packages/config`: validated environment configuration
- `packages/observability`: logging and metrics helpers

See `docs/PRD.md`, `docs/TRD.md`, and `docs/implementation-plan.md` for the product and technical plan.

## Live Dashboard

![Meridian live dashboard](docs/images/phase-4-dashboard-desktop.png)

Actual public BTCUSDT candles, limited-depth order book and trade tape stream over SSE.
Account data and controls use Binance Spot Testnet; unknown wallet valuation remains
explicitly unavailable. The screenshot is read-only with execution blocked, not proof
of active trading. [Mobile screenshot](docs/images/phase-4-dashboard-mobile.png).

Local acceptance: API crash/restart and expired-cursor recovery without page reload;
50 controlled desktop/mobile event-to-render samples, p95 267 ms. A separate k6 test
held 500 simultaneous SSE connections (250 market + 250 account) on one API instance
for 60 seconds, with zero errors/resyncs, p95 delivery 266 ms and peak API RSS 132 MiB.
The unchanged 300-request/minute/IP limit was respected through staggered cohorts.
These are synthetic local workloads, not 500 browser sessions, exchange-to-screen
latency, a long soak or Internet/production acceptance. The 24h ingestion and 48h
unattended trading gates remain pending.

Setup and repeatable verification commands: [scripts/README.md](scripts/README.md).
Full result artifacts remain in ignored `logs/verification/phase-4-2/`.

## Ingestion Benchmark

Local 60-second k6 synthetic-trade baseline (four closed-loop VUs, Redis AOF and
durable per-event Timescale writes):

| Events/s | Receipt-to-bus p95 | DB-inclusive p95 | Sampled ingestor RSS peak |
| -------- | ------------------ | ---------------- | ------------------------- |
| 165.07   | 42.45 ms           | 50.19 ms         | 97.77 MiB                 |

All 9,909 completed events match durable rows, with zero failures and bounded retained
Redis history. This does **not** meet the TRD <10ms bus target or prove 2k+ throughput.
It is not a saturation, mixed-topic, 2-vCPU/2-GB or long-soak result.
[Method, caveats and evidence](docs/benchmark.md); command: `node scripts/verify-ingest-benchmark.cjs`.
