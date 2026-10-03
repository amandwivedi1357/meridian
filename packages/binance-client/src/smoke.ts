import { BinanceRestClient } from "./rest/client.js";

const client = new BinanceRestClient({ environment: "production" });

const time = await client.getServerTime();
console.log("serverTime", time.serverTime);

const depth = await client.getDepth({ symbol: "BTCUSDT", limit: 5 });
console.log("depth", {
  lastUpdateId: depth.lastUpdateId,
  bestBid: depth.bids[0],
  bestAsk: depth.asks[0]
});

const klines = await client.getKlines({
  symbol: "BTCUSDT",
  interval: "1m",
  limit: 1
});
console.log("klines", klines[0]);
