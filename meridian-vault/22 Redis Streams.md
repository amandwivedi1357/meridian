# Redis Streams

Redis Streams will be the event bus for market data and internal signals.

## Planned Use

Market data flow:

```txt
apps/ingestor
    -> XADD market.trades
    -> XADD market.klines
    -> XADD market.depth
```

Consumers:

- strategy engine
- API gateway
- persistence workers
- monitoring tools

## Why Redis Streams

- append-only event stream
- consumer groups
- acknowledgements
- retry stuck messages with `XAUTOCLAIM`
- easier to run locally than Kafka for this project

Related:

- [[03 Phase Roadmap]]
- [[23 TimescaleDB]]
- [[26 Observability]]

