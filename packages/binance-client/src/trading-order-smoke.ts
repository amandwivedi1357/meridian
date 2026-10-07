import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Decimal } from "@meridian/core";
import { BinanceRestClient } from "./rest/client.js";
import { BinanceSignedRequestError } from "./rest/authenticated-http.js";
import { createTestnetTradingClientFromEnv } from "./rest/testnet-runtime.js";

interface Args {
  readonly symbol: string;
  readonly quantity: string;
  readonly confirm: boolean;
}

function readArg(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseArgs(args: readonly string[]): Args {
  const symbol = readArg(args, "--symbol");
  const quantity = readArg(args, "--quantity");
  const confirm = args.includes("--confirm-testnet-order");

  if (
    symbol === undefined ||
    quantity === undefined ||
    !confirm ||
    !/^[A-Z0-9]{2,30}$/.test(symbol)
  ) {
    throw new Error(
      "Usage: smoke:trading-order --symbol BTCUSDT --quantity 0.0002 --confirm-testnet-order"
    );
  }

  return { symbol, quantity, confirm };
}

async function choosePassiveBuyPrice(symbol: string): Promise<string> {
  const publicClient = new BinanceRestClient({ environment: "testnet" });
  const depth = await publicClient.getDepth({ symbol, limit: 5 });
  const bestBid = depth.bids[0]?.[0];

  if (bestBid === undefined) {
    throw new Error("Unable to read Testnet best bid");
  }

  return new Decimal(bestBid).times("0.995").toDecimalPlaces(2, Decimal.ROUND_DOWN).toString();
}

async function main(): Promise<void> {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

  const args = parseArgs(process.argv.slice(2));
  const client = await createTestnetTradingClientFromEnv();
  const clientOrderId = `meridian-smoke-${Date.now()}`;
  const price = await choosePassiveBuyPrice(args.symbol);

  try {
    await client.synchronizeTime();

    const placed = await client.placeOrder({
      symbol: args.symbol,
      side: "BUY",
      type: "LIMIT",
      quantity: args.quantity,
      price,
      timeInForce: "GTC",
      clientOrderId,
    });

    const queried = await client.queryOrder({
      symbol: args.symbol,
      clientOrderId,
    });

    const canceled = await client.cancelOrder({
      symbol: args.symbol,
      clientOrderId,
    });

    const openOrders = await client.openOrders({ symbol: args.symbol });

    console.log(
      JSON.stringify({
        environment: "testnet",
        symbol: args.symbol,
        clientOrderId,
        price,
        quantity: args.quantity,
        placedStatus: placed.status,
        queriedStatus: queried.status,
        canceledStatus: canceled.status,
        stillOpen: openOrders.some((order) => order.clientOrderId === clientOrderId),
        ordersPlaced: 1,
        ordersCanceled: 1,
      })
    );
  } finally {
    client.close();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof BinanceSignedRequestError) {
    console.error(
      JSON.stringify({
        message: error.message,
        outcome: error.outcome,
        status: error.status,
        code: error.code,
        retryAfter: error.retryAfter,
      })
    );
  } else {
    console.error(error instanceof Error ? error.message : "Testnet order smoke failed");
  }

  process.exitCode = 1;
});