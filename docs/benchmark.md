# Local Ingestion Benchmark

Verified 2026-10-11 with `node scripts/verify-ingest-benchmark.cjs`.

| Measurement                                 | Observed                            |
| ------------------------------------------- | ----------------------------------- |
| Duration / load                             | 60 seconds, four closed-loop k6 VUs |
| Successfully published and persisted trades | 9,909                               |
| Throughput                                  | 165.07 events/second                |
| Local receipt to Redis publication p95      | 42.45 ms                            |
| Receipt through durable DB write p95        | 50.19 ms                            |
| HTTP request p95                            | 51.18 ms                            |
| Sampled ingestor RSS / heap peak            | 97.77 / 31.51 MiB                   |
| Maximum queued/in-flight events             | 4                                   |
| Retained Redis entries / durable DB rows    | 2,010 / 9,909                       |
| Failed requests/events                      | 0                                   |

Method: Windows Node + Docker Desktop; production event normalization, Decimal/protobuf
encoding, Redis publisher and Timescale writer, serial queued ingestion, Redis AOF,
per-event durable trade upserts and approximate stream MAXLEN 2000. Synthetic BTCUSDT
trades only; no exchange, recorder, engine, executor or browser. HTTP receipt is the
local timing origin and includes queue wait; bus timing excludes the subsequent DB write.
Fixture PostgreSQL shared_buffers=64MB overrides image autotuning; this is not the
TRD's controlled 2-vCPU/2-GB host. Four closed-loop VUs do not establish a saturation ceiling.

Memory/CPU/event-loop samples are taken every 100ms for the ingestor fixture only;
short peaks can be missed. Container resource snapshots are captured after load, not
peak storage measurements. All completed counts match actual persisted DB rows;
retained protobuf payload decodes successfully. Fixture shutdown exits zero.
Ownership-checked disposable container/volume cleanup completes before success is saved.
Evidence: ignored `logs/verification/phase-5/ingest-benchmark/result.json`,
`k6-summary.json` and `k6.log`. Failed harness attempts are not acceptance evidence.

**TRD comparison:** 42.45ms does not meet the <10ms receipt-to-bus target.
The measured 165 events/s does not demonstrate >=2,000 events/s; a 2k offered-load
or saturation test has not been run. Mixed depth/kline, 20k burst, bus-to-strategy,
order submission and long-run resource stability remain unaccepted. Existing separate
500-SSE acceptance is documented in README, not inferred from this benchmark.
Batching/persistence scheduling should be investigated before claiming production capacity;
this task deliberately records the current implementation without changing its durability.
