import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createTestnetTradingClientFromEnv } from "./rest/testnet-runtime.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^[A-Z0-9]{2,30}$/.test(args[0]!)) {
    throw new Error("Usage: smoke:trading <SYMBOL>");
  }
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
  const client = await createTestnetTradingClientFromEnv();
  let timeout: NodeJS.Timeout | undefined;
  try {
    await client.synchronizeTime();
    const orders = await client.openOrders({ symbol: args[0] });
    let eventsReceived = 0;
    client.userData.onEvent(() => {
      eventsReceived += 1;
    });
    const opened = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("User-data smoke subscription timed out")),
        30_000
      );
      client.userData.onStateChange((state) => {
        if (state === "OPEN") resolve();
        if (state === "FAILED") reject(new Error("User-data smoke authentication failed"));
      });
    });
    client.userData.start();
    await opened;
    clearTimeout(timeout);
    await new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, 15_000);
    });
    if (client.userData.getState() !== "OPEN" || client.userData.getReconnectCount() > 0) {
      throw new Error("User-data smoke was interrupted; investigate before retrying");
    }
    console.log(
      JSON.stringify({
        environment: "testnet",
        symbol: args[0],
        openOrderCount: orders.length,
        userDataState: client.userData.getState(),
        eventsReceived,
        ordersPlaced: 0
      })
    );
  } finally {
    clearTimeout(timeout);
    client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Testnet trading smoke failed");
  process.exitCode = 1;
});
