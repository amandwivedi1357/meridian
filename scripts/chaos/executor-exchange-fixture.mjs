import { createServer } from "node:http";
import { URL } from "node:url";
import { createHmac } from "node:crypto";
import { Pool } from "../../apps/api/node_modules/pg/lib/index.js";
import Redis from "../../apps/api/node_modules/ioredis/built/index.js";
import { WebSocketServer } from "../../packages/binance-client/node_modules/ws/index.js";
import { runMigrations } from "../../packages/db/src/migration-runner.js";
import { marketDataMigrations } from "../../packages/db/src/market-data-migrations.js";
import { createPostgresMigrationRunnerDeps } from "../../packages/db/src/postgres-adapter.js";

async function main() {
  const pool = new Pool({
    connectionString: "postgres://fixture:fixture@database:5432/fixture",
    max: 3
  });
  const redis = new Redis("redis://redis:6379", {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 1000
  });
  redis.on("error", () => {});
  await runMigrations(marketDataMigrations, createPostgresMigrationRunnerDeps(pool));
  await pool.query(
    "CREATE TABLE simulated_orders (client_id text PRIMARY KEY, body jsonb NOT NULL, sends integer NOT NULL DEFAULT 1)"
  );
  // A new disposable database only; the shared project kill state is never reset.
  await pool.query(
    "UPDATE risk_control_state SET engaged=false,reason='isolated-runtime-verification'"
  );
  await redis.set("meridian:risk:kill-switch", "0");
  let hold = false;
  let signalSequence = 0;
  let orderSequence = 0;
  let unexpectedRequests = 0;
  let writeAheadViolations = 0;
  let totalSends = 0;
  let cancellations = 0;
  const held = new Set();
  const sockets = new Set();
  const signals = new Map();
  const signature = (payload) =>
    createHmac("sha256", "fixture-only-secret").update(payload).digest("hex");
  function emit(order, state = order.status, at = Date.now(), fill = false) {
    const event = {
      e: "executionReport",
      E: at,
      T: at,
      s: order.symbol,
      c: order.clientOrderId,
      S: order.side,
      o: order.type,
      x: fill ? "TRADE" : state === "CANCELED" ? "CANCELED" : "NEW",
      X: state,
      i: order.orderId,
      I: fill ? 1000 + order.orderId : at,
      q: order.origQty,
      p: order.price,
      l: fill ? order.origQty : "0",
      L: fill ? order.price : "0",
      z: state === "FILLED" ? order.origQty : "0",
      Z: state === "FILLED" ? String(Number(order.origQty) * Number(order.price)) : "0",
      n: "0",
      N: "USDT",
      t: fill ? 1000 + order.orderId : -1,
      m: false
    };
    for (const socket of sockets)
      if (socket.readyState === 1) socket.send(JSON.stringify({ subscriptionId: 1, event }));
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://exchange:8082");
      const reply = (body, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (url.pathname === "/control/state") {
        const pending = await redis.xpending("signals", "executor").catch(() => null);
        return reply({
          totalSends,
          cancellations,
          unexpectedRequests,
          writeAheadViolations,
          subscriptions: sockets.size,
          held: held.size,
          pending,
          orders: (
            await pool.query(
              "SELECT client_order_id,state,executed_quantity::text FROM orders ORDER BY created_at"
            )
          ).rows,
          exchange: (
            await pool.query("SELECT client_id,sends,body FROM simulated_orders ORDER BY client_id")
          ).rows,
          fills: Number((await pool.query("SELECT count(*) FROM order_fills")).rows[0].count),
          kill: (await pool.query("SELECT engaged FROM risk_control_state")).rows[0].engaged,
          rejections: Number(
            (await pool.query("SELECT count(*) FROM risk_events WHERE type='signal-rejected'"))
              .rows[0].count
          )
        });
      }
      if (request.method === "POST" && url.pathname === "/control/signal") {
        const key = url.searchParams.get("key") || `signal-${++signalSequence}`;
        let signal = signals.get(key);
        if (!signal) {
          const now = Date.now();
          signal = {
            signalId: key,
            strategyId: "chaos",
            createdAtMs: now,
            validUntilMs: now + 300000,
            intent: {
              symbol: "BTCUSDT",
              side: "BUY",
              type: "LIMIT",
              quantity: "0.0001",
              limitPrice: "81000",
              reason: "isolated chaos verification"
            }
          };
          signals.set(key, signal);
        }
        const id = await redis.xadd(
          "signals",
          "*",
          "kind",
          "signal",
          "payload",
          JSON.stringify(signal)
        );
        return reply({ id, key });
      }
      if (request.method === "POST" && url.pathname === "/control/hold") {
        hold = url.searchParams.get("enabled") === "true";
        if (!hold) {
          for (const response of held) response.destroy();
          held.clear();
        }
        return reply({ hold });
      }
      if (request.method === "POST" && url.pathname === "/control/fill") {
        const row = (
          await pool.query("SELECT body FROM simulated_orders ORDER BY client_id LIMIT 1")
        ).rows[0];
        if (!row) throw new Error("No simulated order to fill");
        const order = {
          ...row.body,
          status: "FILLED",
          executedQty: row.body.origQty,
          cummulativeQuoteQty: String(Number(row.body.origQty) * Number(row.body.price)),
          updateTime: Date.now()
        };
        await pool.query("UPDATE simulated_orders SET body=$2 WHERE client_id=$1", [
          order.clientOrderId,
          order
        ]);
        emit(order, "FILLED", order.updateTime, true);
        emit(order, "FILLED", order.updateTime, true);
        emit(order, "NEW", order.updateTime - 1000);
        return reply({ emitted: 3 });
      }
      if (url.pathname === "/api/v3/time") return reply({ serverTime: Date.now() });
      if (url.pathname === "/api/v3/exchangeInfo")
        return reply({
          symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }]
        });
      if (url.pathname === "/api/v3/depth")
        return reply({ lastUpdateId: 1, bids: [["81000", "1"]], asks: [["81001", "1"]] });
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 8192) throw new Error("Fixture request too large");
        }
        url.search = body;
      }
      const supplied = url.searchParams.get("signature");
      url.searchParams.delete("signature");
      if (
        request.headers["x-mbx-apikey"] !== "fixture-only" ||
        supplied !== signature(url.searchParams.toString())
      )
        return reply({ code: -1022, msg: "Invalid fixture signature" }, 400);
      if (url.pathname === "/api/v3/account")
        return reply({
          balances: [
            { asset: "USDT", free: "10000", locked: "0" },
            { asset: "BTC", free: "0.0001", locked: "0" }
          ]
        });
      if (url.pathname === "/api/v3/myTrades") return reply([]);
      if (url.pathname === "/api/v3/openOrders")
        return reply(
          (
            await pool.query("SELECT body FROM simulated_orders WHERE body->>'status'='NEW'")
          ).rows.map((row) => row.body)
        );
      if (url.pathname === "/api/v3/order") {
        const params = url.searchParams;
        const id = params.get("newClientOrderId") || params.get("origClientOrderId");
        const previous = (
          await pool.query("SELECT body FROM simulated_orders WHERE client_id=$1", [id])
        ).rows[0]?.body;
        if (request.method === "POST") {
          const local = (
            await pool.query("SELECT state FROM orders WHERE client_order_id=$1", [id])
          ).rows[0];
          if (local?.state !== "UNKNOWN") {
            writeAheadViolations++;
            return reply({ code: -2010, msg: "Missing durable claim" }, 400);
          }
          totalSends++;
          if (previous) {
            await pool.query("UPDATE simulated_orders SET sends=sends+1 WHERE client_id=$1", [id]);
            return reply({ code: -2010, msg: "Duplicate order sent" }, 400);
          }
          const order = {
            symbol: params.get("symbol"),
            orderId: ++orderSequence,
            orderListId: -1,
            clientOrderId: id,
            price: params.get("price") || "81000",
            origQty: params.get("quantity"),
            executedQty: "0",
            cummulativeQuoteQty: "0",
            status: "NEW",
            side: params.get("side"),
            type: params.get("type"),
            timeInForce: "GTC",
            updateTime: Date.now()
          };
          await pool.query("INSERT INTO simulated_orders(client_id,body) VALUES ($1,$2)", [
            id,
            order
          ]);
          if (hold) {
            held.add(response);
            response.on("close", () => held.delete(response));
            return;
          }
          emit(order);
          return reply(order);
        }
        if (!previous) return reply({ code: -2013, msg: "Order does not exist" }, 400);
        if (request.method === "DELETE") {
          const order = { ...previous, status: "CANCELED", updateTime: Date.now() };
          await pool.query("UPDATE simulated_orders SET body=$2 WHERE client_id=$1", [id, order]);
          cancellations++;
          emit(order);
          return reply(order);
        }
        return reply(previous);
      }
      unexpectedRequests++;
      reply({ error: "unexpected fixture request" }, 404);
    })().catch((error) => {
      response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });
  const wss = new WebSocketServer({ server, path: "/ws-api/v3" });
  wss.on("connection", (socket) => {
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw) => {
      try {
        const { id, method, params } = JSON.parse(raw.toString());
        const payload = `apiKey=${params.apiKey}&recvWindow=${params.recvWindow}&timestamp=${params.timestamp}`;
        if (
          method !== "userDataStream.subscribe.signature" ||
          params.apiKey !== "fixture-only" ||
          params.signature !== signature(payload)
        )
          throw new Error("Invalid fixture subscription");
        sockets.add(socket);
        socket.send(JSON.stringify({ id, status: 200, result: { subscriptionId: 1 } }));
      } catch {
        socket.terminate();
      }
    });
  });
  await new Promise((resolve) => server.listen(8082, "0.0.0.0", resolve));
  console.log(JSON.stringify({ fixtureReady: true }));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
