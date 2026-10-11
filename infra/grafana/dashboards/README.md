# Grafana dashboards

Provisioned JSON dashboards:

- `meridian-operations`: scraper/readiness, dependency availability, upstream age,
  ingestion/queue/latency, retained streams, consumer lag/pending, HTTP rate, RSS,
  backtest dispatcher readiness/children and Binance REST status/IP weight (15 panels).
- `meridian-trading-risk`: Executor kill switch, runtime work/failures/latency and
  risk rejection rate, submit-operation p95, durable order/job states, persisted
  fill timing quantiles and local signal-processing p95 (ten panels). Poll work is not an
  order count or confirmed fill count; submit latency is not fill latency.
- `meridian-pnl-risk`: persisted-fill realized/unrealized PnL and validated executor
  drawdown/effective limit (three panels), with freshness and scope labels.

Datasource UID is `meridian-prometheus`. Missing telemetry stays absent/Not reported;
an inactive Engine/Executor is not made healthy by API availability. Readiness and
kill switch stats filter out failed scrapes. Durable order populations are gauges,
not transition counters; fill timing is sampled from the latest 1,000 persisted
executions and includes clock skew/partial fills. Production-scale acceptance and
full TRD instrumentation remain pending; these dashboards do not substitute
wallet equity for allocated portfolio performance.

Open at `http://127.0.0.1:3001/d/meridian-operations` and
`http://127.0.0.1:3001/d/meridian-trading-risk` and
`http://127.0.0.1:3001/d/meridian-pnl-risk`. Use your configured Grafana login;
the local password has changed from the Compose default. See `docs/observability.md` for safety
and `scripts/verify-observability.cjs` for repeatable acceptance/screenshots.
