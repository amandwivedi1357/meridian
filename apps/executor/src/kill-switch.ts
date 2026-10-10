import type { RiskRepository } from "@meridian/db";

export const KILL_SWITCH_KEY = "meridian:risk:kill-switch";
export function createKillSwitch(options: {
  repo: RiskRepository;
  command: (args: readonly string[]) => Promise<unknown>;
  listOpenOrders: () => Promise<readonly { symbol: string; clientOrderId: string }[]>;
  cancelOrder: (order: { symbol: string; clientOrderId: string }) => Promise<unknown>;
  alert: (details: Record<string, unknown>) => void;
  nowMs?: () => number;
  timeoutMs?: number;
}) {
  let lastAlertAt = -Infinity;
  const now = options.nowMs ?? Date.now;
  async function command(args: readonly string[]) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        options.command(args),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Risk Redis timeout")),
            options.timeoutMs ?? 1_000
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function alert(reason: string, failures: readonly string[]) {
    if (now() - lastAlertAt < 5_000) return;
    const details = { reason, cancellationFailures: failures };
    options.alert(details);
    try {
      await command([
        "XADD",
        "alerts",
        "MAXLEN",
        "~",
        "1000",
        "*",
        "kind",
        "kill-switch",
        "details",
        JSON.stringify(details)
      ]);
    } catch {
      /* Console and PostgreSQL remain alert channels during a Redis outage. */
    }
    // Do not suppress future alerts if durable delivery failed.
    await options.repo.recordEvent("kill-switch-alert", details);
    lastAlertAt = now();
  }
  async function cancelAll(reason: string) {
    const failures: string[] = [];
    try {
      for (const order of await options.listOpenOrders()) {
        try {
          await options.cancelOrder({ symbol: order.symbol, clientOrderId: order.clientOrderId });
        } catch {
          failures.push(`${order.symbol}:${order.clientOrderId}`);
        }
      }
    } catch {
      failures.push("open-orders-unavailable");
    }
    await alert(reason, failures);
  }
  async function engage(reason: string, actor = "risk-engine") {
    // Both writes are attempted; failure of either never authorizes trading.
    const results = await Promise.allSettled([
      options.repo.locked(async (repo) => {
        const state = await repo.getKillState();
        if (!state.engaged || actor !== "risk-engine") await repo.setKillState(true, reason, actor);
      }),
      command(["SET", KILL_SWITCH_KEY, "1"])
    ]);
    await cancelAll(reason);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Kill-switch persistence unavailable");
  }
  async function check(): Promise<boolean> {
    try {
      const reason = await options.repo.locked(async (repo) => {
        const state = await repo.getKillState();
        const flag = await command(["GET", KILL_SWITCH_KEY]);
        if (!state.engaged && flag === "0") return undefined;
        const reason = state.engaged ? state.reason : "kill-flag-missing-malformed-or-engaged";
        if (!state.engaged) await repo.setKillState(true, reason, "risk-engine");
        await command(["SET", KILL_SWITCH_KEY, "1"]);
        return reason;
      });
      if (reason === undefined) return false;
      await cancelAll(reason);
    } catch {
      try {
        await engage("risk-critical-dependency-unavailable");
      } catch {
        options.alert({ reason: "risk-critical-dependency-unavailable", retryingCancelAll: true });
      }
    }
    return true;
  }
  return {
    check,
    engage,
    async assertSafe() {
      if (await check()) throw new Error("Kill switch engaged; execution blocked");
    },
    async reset(actor: string, authorize: () => Promise<void>) {
      await authorize();
      await options.repo.locked(async (repo) => {
        // Redis first: if the DB transaction fails, its engaged state still blocks trading.
        await command(["SET", KILL_SWITCH_KEY, "0"]);
        await repo.setKillState(false, "explicit-authenticated-reset", actor);
        await repo.recordEvent("kill-switch-reset", { actor });
      });
      lastAlertAt = -Infinity;
    }
  };
}
export type KillSwitch = ReturnType<typeof createKillSwitch>;
