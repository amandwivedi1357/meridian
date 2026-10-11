import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { Pool } from "pg";
import { Decimal } from "@meridian/core";
import { portfolioSchema } from "../features/account/portfolio.js";

loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url)));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000
});
const headers = process.env.API_VIEWER_TOKEN
  ? { authorization: `Bearer ${process.env.API_VIEWER_TOKEN}` }
  : {};
async function state() {
  return (
    await pool.query(
      "SELECT (SELECT engaged FROM risk_control_state WHERE scope='global') AS engaged,(SELECT count(*)::text FROM orders) AS orders,(SELECT count(*)::text FROM order_fills) AS fills"
    )
  ).rows[0];
}
try {
  const before = await state();
  assert.equal(before.engaged, true);
  const response = await fetch("http://127.0.0.1:3000/api/account/portfolio", {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 200);
  const portfolio = portfolioSchema.parse(await response.json());
  assert.ok(portfolio.wallet?.observedAtMs);
  assert.equal(portfolio.environment, "testnet");
  assert.equal(portfolio.equityScope, "exchange-wallet");
  const unpriced = portfolio.wallet.assets.filter((asset) => asset.value === null).length;
  if (unpriced) {
    assert.equal(portfolio.equity, null);
    assert.equal(portfolio.equityReason, "unpriceable_wallet_assets");
  } else
    assert.equal(
      portfolio.equity,
      portfolio.wallet.assets
        .reduce((sum, asset) => sum.plus(asset.value!), new Decimal(0))
        .toFixed()
    );
  const stream = await fetch("http://127.0.0.1:3000/api/stream/account", {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(stream.status, 200);
  const reader = stream.body!.getReader();
  let text = "",
    delivered = false;
  try {
    while (!delivered) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      text += new TextDecoder().decode(chunk.value);
      assert.ok(text.length < 512 * 1024);
      let split;
      while ((split = text.indexOf("\n\n")) >= 0) {
        const frame = text.slice(0, split);
        text = text.slice(split + 2);
        assert.ok(!frame.includes("event: resync"));
        if (!frame.includes("event: account")) continue;
        const events = JSON.parse(frame.match(/^data: (.+)$/m)![1]!).events as {
          portfolio?: unknown;
        }[];
        delivered = events.some(
          (event) => event.portfolio && portfolioSchema.parse(event.portfolio).wallet?.observedAtMs
        );
      }
    }
  } finally {
    await reader.cancel();
  }
  assert.deepEqual(await state(), before);
  const evidence = {
    checkedAt: new Date().toISOString(),
    environment: "testnet",
    readOnly: true,
    assetCount: portfolio.wallet.assets.length,
    unpricedAssets: unpriced,
    equityStatus: portfolio.wallet.status,
    reconciliation: portfolio.wallet.reconciliation,
    accountSsePassed: delivered,
    killEngaged: true,
    orderCountsUnchanged: true
  };
  const directory = fileURLToPath(new URL("../../../../logs/verification/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/phase-4-1-wallet.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch {
  console.error("Read-only wallet/API verification failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
