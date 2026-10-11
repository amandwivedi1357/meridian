import type { TradingState } from "../../lib/api-client.js";

const terminalStates = new Set(["FILLED", "CANCELED", "REJECTED", "EXPIRED", "EXPIRED_IN_MATCH"]);
export const openOrders = (account: TradingState | null) =>
  (account?.orders ?? []).filter((o) => !terminalStates.has(o.state));
export const uncertainOrders = (account: TradingState | null) =>
  (account?.orders ?? []).filter(
    (o) => o.state === "UNKNOWN" || o.state === "PENDING_CANCEL" || o.state === "PENDING_NEW"
  );
export function activity(account: TradingState | null) {
  return [
    ...(account?.orders ?? []).map((o) => ({
      id: `order:${o.clientOrderId}`,
      time: o.updatedAtMs,
      kind: "Order",
      title: `${o.side} ${o.symbol} / ${o.state}`,
      detail: o.clientOrderId
    })),
    ...(account?.fills ?? []).map((f) => ({
      id: `fill:${f.clientOrderId}:${f.executionId}`,
      time: f.eventTimeMs,
      kind: "Fill",
      title: `${f.side} ${f.quantity} ${f.symbol}`,
      detail: `${f.price} / ${f.strategyId}`
    })),
    ...(account?.riskEvents ?? []).map((r) => ({
      id: `risk:${r.id}`,
      time: r.tsMs,
      kind: "Risk",
      title: r.type,
      detail: JSON.stringify(r.details)
    }))
  ]
    .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id))
    .slice(0, 30);
}
