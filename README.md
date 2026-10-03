# Meridian

Meridian is an event-driven algorithmic trading platform for Binance Spot market data and Binance Spot Testnet execution.

The project is currently in Phase 0: repository foundation, local infrastructure, shared configuration, observability primitives, and CI.

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
