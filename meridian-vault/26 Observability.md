# Observability

Observability proves the system is working and helps debug failures.

## Current Metrics

Stream metrics:

- `ws_reconnects_total`
- `ws_last_message_age_seconds`

Order book metrics:

- `order_book_resyncs_total`
- `order_book_update_lag_seconds`

## Planned Metrics

- Redis consumer lag
- ingestion throughput
- DB write latency
- strategy signal count
- order rejects
- kill switch state
- PnL and drawdown

Related:

- [[20 Order Book]]
- [[22 Redis Streams]]
- [[25 Execution and Risk]]

