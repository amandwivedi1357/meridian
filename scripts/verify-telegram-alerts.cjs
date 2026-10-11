/* global __dirname */
const { fetch, AbortSignal } = globalThis;
const { URL } = require("node:url");
const { setTimeout } = require("node:timers");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const base = "http://127.0.0.1:9093";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Verification endpoint HTTP ${response.status}`);
  return response;
}
async function stats() {
  const text = await (await request(`${base}/metrics`)).text();
  const total = (name) =>
    [
      ...text.matchAll(
        new RegExp(`^${name}\\{[^\\n]*integration="telegram"[^\\n]*\\} ([0-9.e+]+)$`, "gm")
      )
    ].reduce((sum, match) => sum + Number(match[1]), 0);
  return {
    sent: total("alertmanager_notifications_total"),
    failed: total("alertmanager_notifications_failed_total")
  };
}
async function main() {
  const targets = await (await request("http://127.0.0.1:9090/api/v1/alertmanagers")).json();
  if (!targets.data?.activeAlertmanagers?.some((t) => new URL(t.url).hostname === "alertmanager"))
    throw new Error("Prometheus has no active Alertmanager target");
  const initial = await stats();
  const labels = {
    alertname: "MeridianDeliveryVerification",
    job: "meridian-verification",
    severity: "info",
    verification_id: randomUUID()
  };
  const start = new Date();
  const send = (endsAt) =>
    request(`${base}/api/v2/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          labels,
          annotations: { summary: "Bounded local Telegram delivery check; no trading action." },
          startsAt: start.toISOString(),
          endsAt: endsAt.toISOString()
        }
      ])
    });
  async function waitFor(count) {
    const deadline = Date.now() + 100000;
    while (Date.now() < deadline) {
      const current = await stats();
      if (current.failed > initial.failed)
        throw new Error(
          "Telegram notification failure; inspect configuration without sharing token"
        );
      if (current.sent - current.failed >= initial.sent - initial.failed + count) return current;
      await sleep(2000);
    }
    throw new Error("Telegram delivery timed out");
  }
  await send(new Date(Date.now() + 180000));
  await waitFor(1);
  // Resolve only our synthetic alert, never silence or change actual operational alerts.
  await send(new Date());
  const final = await waitFor(2);
  const result = {
    success: true,
    prometheusTarget: true,
    telegramAcceptedNotifications: final.sent - initial.sent,
    failedNotifications: final.failed - initial.failed,
    checkedAt: new Date().toISOString(),
    scope:
      "Synthetic Alertmanager firing/resolved; delivery counters prove Telegram API acceptance, not human read receipt"
  };
  const output = path.resolve(__dirname, "../logs/verification/phase-5/telegram.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(() => {
  console.error("Telegram alert verification failed; no credentials printed.");
  process.exitCode = 1;
});
