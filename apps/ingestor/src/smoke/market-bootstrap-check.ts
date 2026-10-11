import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import {
  createStreamConnectionManager,
  depthStream,
  klineStream,
  tradeStream
} from "@meridian/binance-client";
import { createIngestorApp } from "../runtime/app-bootstrap.js";
import { loadIngestorConfig } from "../runtime/config.js";
import { createRuntimeClients } from "../runtime/runtime-clients.js";

loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));
assert.equal(process.env.MARKET_DATA_ENV ?? "production", "production");
const clients = createRuntimeClients(loadIngestorConfig());
const app = createIngestorApp(clients);
const manager = createStreamConnectionManager({
  environment: "production",
  subscriptions: [tradeStream("BTCUSDT"), klineStream("BTCUSDT", "15m"), depthStream("BTCUSDT")]
});
const counts = { trade: 0, kline: 0, depth: 0 };
let pending = Promise.resolve(),
  backlog = 0,
  stopped = false,
  failure: unknown;
const deadline = Date.now() + 60000;
const bounded = new AbortController();
const timer = setTimeout(() => {
  bounded.abort();
  manager.close();
  stopped = true;
}, 60000);
const origin = "http://127.0.0.1:3000";
const headers = process.env.API_VIEWER_TOKEN
  ? { authorization: `Bearer ${process.env.API_VIEWER_TOKEN}` }
  : {};
const signal = () => AbortSignal.any([bounded.signal, AbortSignal.timeout(5000)]);
let stage = "startup";
const sleep = () => new Promise((resolve) => setTimeout(resolve, 200));
async function batch(cursor: string, resume = false) {
  const response = await fetch(
    `${origin}/api/stream/market?symbol=BTCUSDT&interval=15m${resume ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
    { headers: { ...headers, ...(resume ? { "Last-Event-ID": cursor } : {}) }, signal: signal() }
  );
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  let text = "",
    ready = false;
  const events: { kind: string; depth?: { firstUpdateId: number; finalUpdateId: number } }[] = [];
  try {
    while (Date.now() < deadline) {
      const part = await reader.read();
      assert.equal(part.done, false);
      text += new TextDecoder().decode(part.value);
      assert.ok(text.length < 512 * 1024);
      let split;
      while ((split = text.indexOf("\n\n")) >= 0) {
        const frame = text.slice(0, split);
        text = text.slice(split + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1],
          id = frame.match(/^id: (.+)$/m)?.[1];
        if (event === "ready") {
          assert.equal(id, cursor);
          ready = true;
        }
        assert.notEqual(event, "resync");
        if (event === "market") {
          assert.ok(ready);
          assert.ok(id && id !== cursor);
          const data = JSON.parse(frame.match(/^data: (.+)$/m)![1]!);
          events.push(...data.events);
          assert.ok(events.length <= 1000, "sse_batch_capacity");
          if (events.some((event) => event.kind === "depth")) return { cursor: id, events };
        }
      }
    }
    throw new Error("sse_deadline");
  } finally {
    await reader.cancel();
  }
}
try {
  await clients.redis.connect();
  await app.start();
  manager.onMessage((message) => {
    if (stopped || failure) return;
    if (++backlog > 1000) {
      failure = new Error("ingest_backlog_capacity");
      manager.close();
      return;
    }
    pending = pending
      .then(async () => {
        const result = await app.ingest(message.data);
        counts[result.event.kind]++;
      })
      .catch((error) => {
        failure = error;
        manager.close();
      })
      .finally(() => {
        backlog--;
      });
  });
  manager.connect();
  stage = "waiting_for_public_feed";
  while (counts.depth < 3 || !counts.trade || !counts.kline) {
    if (failure) throw failure;
    assert.ok(Date.now() < deadline, "feed_deadline");
    await sleep();
  }
  let snapshot:
    | {
        cursor: string;
        book: { lastUpdateId: number; complete: boolean; bids: unknown[]; asks: unknown[] };
        trades: unknown[];
        candles: unknown[];
      }
    | undefined;
  stage = "rest_bootstrap";
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${origin}/api/market/snapshot?symbol=BTCUSDT&interval=15m`, {
      headers,
      signal: signal()
    });
    if (response.ok) {
      snapshot = (await response.json()) as typeof snapshot;
      break;
    }
    await sleep();
  }
  assert.ok(snapshot, "bootstrap_unavailable");
  assert.ok(snapshot.book.bids.length && snapshot.book.asks.length);
  assert.equal(snapshot.book.complete, false);
  assert.ok(snapshot.trades.length && snapshot.candles.length);
  stage = "sse_cursor_handoff";
  const first = await batch(snapshot.cursor);
  stage = "sse_last_event_id_resume";
  const second = await batch(first.cursor, true);
  stage = "book_continuity";
  let updateId = snapshot.book.lastUpdateId,
    deliveredDepth = 0;
  for (const event of [...first.events, ...second.events]) {
    if (event.kind !== "depth") continue;
    assert.ok(event.depth!.firstUpdateId <= updateId + 1, "book_handoff_gap");
    assert.ok(event.depth!.finalUpdateId > updateId, "duplicate_book_update");
    updateId = event.depth!.finalUpdateId;
    deliveredDepth++;
  }
  assert.ok(deliveredDepth > 0);
  assert.ok(updateId > snapshot.book.lastUpdateId);
  if (failure) throw failure;
  const evidence = {
    checkedAt: new Date().toISOString(),
    environment: "production-public-market-only",
    counts,
    snapshot: {
      tradeCount: snapshot.trades.length,
      candleCount: snapshot.candles.length,
      bookUpdateId: snapshot.book.lastUpdateId
    },
    sse: {
      firstBatch: first.events.length,
      resumedBatch: second.events.length,
      deliveredDepth,
      finalUpdateId: updateId
    },
    bootstrapPassed: true,
    cursorHandoffPassed: true,
    lastEventIdResumePassed: true
  };
  const directory = fileURLToPath(new URL("../../../../logs/verification/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/phase-4-1-market-bootstrap.json`,
    JSON.stringify(evidence, null, 2)
  );
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      reason:
        error instanceof Error &&
        (/^[a-z_]+$/.test(error.message) || error.name === "AssertionError")
          ? error.message
          : "verification_failed"
    })
  );
  process.exitCode = 1;
} finally {
  stopped = true;
  clearTimeout(timer);
  bounded.abort();
  manager.close();
  await pending;
  await clients.close();
}
