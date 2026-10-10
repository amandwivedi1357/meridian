import type { RiskRepository } from "@meridian/db";
import { describe, expect, it, vi } from "vitest";
import { createKillSwitch, KILL_SWITCH_KEY } from "./kill-switch.js";

function fixture() {
  let engaged = false;
  let flag: unknown = "0";
  let now = 0;
  const repo = {
    getKillState: vi.fn(async () => ({ engaged, reason: "operator" })),
    setKillState: vi.fn(async (value: boolean) => {
      engaged = value;
    }),
    recordEvent: vi.fn(async () => undefined),
    updatePeak: vi.fn(),
    listFills: vi.fn(),
    listActiveReservations: vi.fn(),
    countRecentReservations: vi.fn(),
    reserve: vi.fn(),
    locked: vi.fn()
  } satisfies RiskRepository;
  repo.locked.mockImplementation(async (work) => work(repo));
  const command = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "GET") return flag;
    if (args[0] === "SET") {
      flag = args[2];
      return "OK";
    }
    return "1-0";
  });
  const listOpenOrders = vi.fn(async () => [{ symbol: "BTCUSDT", clientOrderId: "order-1" }]);
  const cancelOrder = vi.fn(async () => undefined);
  const alert = vi.fn();
  const kill = createKillSwitch({
    repo,
    command,
    listOpenOrders,
    cancelOrder,
    alert,
    nowMs: () => now,
    timeoutMs: 10
  });
  return {
    kill,
    repo,
    command,
    listOpenOrders,
    cancelOrder,
    alert,
    setFlag(value: unknown) {
      flag = value;
    },
    setEngaged(value: boolean) {
      engaged = value;
    },
    advance() {
      now += 5000;
    }
  };
}
describe("durable fail-closed kill switch", () => {
  it("projects native open-order DTOs to strict cancellation lookup fields", async () => {
    const f = fixture();
    const order = {
      symbol: "BTCUSDT",
      clientOrderId: "order-1",
      orderId: 123,
      status: "NEW",
      origQty: "0.0002",
      price: "81000"
    };
    f.listOpenOrders.mockResolvedValue([order]);
    f.setEngaged(true);
    await f.kill.check();
    expect(f.cancelOrder).toHaveBeenCalledOnce();
    expect(f.cancelOrder).toHaveBeenCalledWith({ symbol: "BTCUSDT", clientOrderId: "order-1" });
  });
  it("allows trading only when both stores explicitly say inactive", async () => {
    const f = fixture();
    expect(await f.kill.check()).toBe(false);
    expect(f.cancelOrder).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "", "false", 0, "garbage", "1"])(
    "latches and cancels for flag %s",
    async (flag) => {
      const f = fixture();
      f.setFlag(flag);
      expect(await f.kill.check()).toBe(true);
      expect(f.repo.setKillState).toHaveBeenCalledWith(
        true,
        "kill-flag-missing-malformed-or-engaged",
        "risk-engine"
      );
      expect(f.cancelOrder).toHaveBeenCalledWith({ symbol: "BTCUSDT", clientOrderId: "order-1" });
      expect(f.alert).toHaveBeenCalledOnce();
      expect(f.command).toHaveBeenCalledWith(expect.arrayContaining(["XADD", "alerts"]));
    }
  );
  it("preserves a DB engagement after Redis was cleared", async () => {
    const f = fixture();
    f.setEngaged(true);
    f.setFlag("0");
    await expect(f.kill.assertSafe()).rejects.toThrow("execution blocked");
    expect(f.command).toHaveBeenCalledWith(["SET", KILL_SWITCH_KEY, "1"]);
  });
  it("keeps retrying cancellation during a Redis outage", async () => {
    const f = fixture();
    f.command.mockRejectedValue(new Error("Redis offline"));
    expect(await f.kill.check()).toBe(true);
    f.advance();
    expect(await f.kill.check()).toBe(true);
    expect(f.cancelOrder.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(f.alert.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it("cancels even when the durable flag cannot be read", async () => {
    const f = fixture();
    f.repo.getKillState.mockRejectedValue(new Error("DB offline"));
    expect(await f.kill.check()).toBe(true);
    expect(f.cancelOrder).toHaveBeenCalled();
    expect(f.alert).toHaveBeenCalled();
  });
  it("continues after individual cancellation failures", async () => {
    const f = fixture();
    f.setEngaged(true);
    f.listOpenOrders.mockResolvedValue([
      { symbol: "BTCUSDT", clientOrderId: "one" },
      { symbol: "ETHUSDT", clientOrderId: "two" }
    ]);
    f.cancelOrder.mockRejectedValueOnce(new Error("network"));
    await f.kill.check();
    expect(f.cancelOrder).toHaveBeenCalledTimes(2);
    expect(f.alert).toHaveBeenCalledWith(
      expect.objectContaining({ cancellationFailures: ["BTCUSDT:one"] })
    );
  });
  it("bounds Redis reads that never resolve", async () => {
    const f = fixture();
    f.command.mockImplementation(async () => new Promise(() => {}));
    expect(await f.kill.check()).toBe(true);
    expect(f.cancelOrder).toHaveBeenCalled();
  });
  it("requires successful authentication before reset", async () => {
    const f = fixture();
    f.setEngaged(true);
    await expect(
      f.kill.reset("operator", async () => {
        throw new Error("unauthorized");
      })
    ).rejects.toThrow("unauthorized");
    expect(f.repo.setKillState).not.toHaveBeenCalled();
    expect(f.command).not.toHaveBeenCalled();
    await f.kill.reset("operator", async () => {});
    expect(f.repo.setKillState).toHaveBeenCalledWith(
      false,
      "explicit-authenticated-reset",
      "operator"
    );
    expect(f.repo.recordEvent).toHaveBeenCalledWith("kill-switch-reset", { actor: "operator" });
  });
});
