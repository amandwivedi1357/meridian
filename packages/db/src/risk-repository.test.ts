import { describe, expect, it, vi } from "vitest";
import { createRiskRepository } from "./risk-repository.js";
import type { OrderWriteAheadRepositoryDeps } from "./order-write-ahead-repository.js";
import type { SqlQuery } from "./migration-runner.js";

function fixture() {
  const execute = vi.fn(
    async (query: SqlQuery): Promise<{ rowCount: number; rows: readonly unknown[] }> => {
      void query;
      return { rowCount: 1, rows: [] };
    }
  );
  const transactionSpy = vi.fn();
  async function transaction<T>(work: (db: OrderWriteAheadRepositoryDeps) => Promise<T>) {
    transactionSpy();
    return work({ execute });
  }
  return { execute, transactionSpy, repo: createRiskRepository({ execute, transaction }) };
}
describe("risk repository", () => {
  it("locks risk approvals on a pinned transaction connection", async () => {
    const f = fixture();
    await f.repo.locked(async (repo) => {
      await repo.recordEvent("test", { reason: "blocked" });
    });
    expect(f.transactionSpy).toHaveBeenCalledOnce();
    expect(f.execute.mock.calls[0]?.[0].text).toContain("pg_advisory_xact_lock");
    expect(f.execute.mock.calls[1]?.[0].values).toEqual(["test", '{"reason":"blocked"}']);
  });
  it.each([{ rows: [] }, { rows: [{ engaged: "false", reason: "invalid" }] }])(
    "fails closed on missing/malformed durable state",
    async ({ rows }) => {
      const f = fixture();
      f.execute.mockResolvedValue({ rowCount: 1, rows });
      await expect(f.repo.getKillState()).rejects.toThrow("Kill state unavailable");
    }
  );
  it("updates kill state and audit record in one atomic SQL statement", async () => {
    const f = fixture();
    await f.repo.setKillState(true, "loss", "breaker");
    expect(f.execute.mock.calls[0]?.[0].text).toContain("INSERT INTO audit_log");
    expect(f.execute.mock.calls[0]?.[0].values).toEqual([
      true,
      "loss",
      "breaker",
      "kill-switch-engaged"
    ]);
    f.execute.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(f.repo.setKillState(false, "reset", "operator")).rejects.toThrow("unavailable");
  });
  it("fails when risk event insertion cannot be confirmed", async () => {
    const f = fixture();
    f.execute.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(f.repo.recordEvent("reject", {})).rejects.toThrow("persistence failed");
  });
  it("keeps the durable high-water mark monotonic", async () => {
    const f = fixture();
    f.execute.mockResolvedValue({ rowCount: 1, rows: [{ peak: "1000" }] });
    expect(await f.repo.updatePeak("900")).toBe("1000");
    expect(f.execute.mock.calls[0]?.[0].text).toContain(
      "greatest(risk_equity_state.peak, EXCLUDED.peak)"
    );
  });
  it("keeps uncertain submissions reserved past signal expiry", async () => {
    const f = fixture();
    await f.repo.listActiveReservations(1000);
    expect(f.execute.mock.calls[0]?.[0].text).toContain("'UNKNOWN'");
    expect(f.execute.mock.calls[0]?.[0].text).toContain("o.signal_id = r.signal_id");
  });
  it("parameterizes a sliding-minute order count", async () => {
    const f = fixture();
    f.execute.mockResolvedValue({ rowCount: 1, rows: [{ count: "3" }] });
    expect(await f.repo.countRecentReservations("ema", 100000)).toBe(3);
    expect(f.execute.mock.calls[0]?.[0].values).toEqual(["ema", 40000]);
  });
});
