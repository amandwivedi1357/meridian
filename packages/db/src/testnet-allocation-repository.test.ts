import { describe, expect, it, vi } from "vitest";
import type { SqlQuery } from "./migration-runner.js";
import {
  createTestnetAllocationRepository,
  testnetAccountBinding
} from "./testnet-allocation-repository.js";
const policy = { id: "check", quoteAsset: "USDT", initialQuote: "100", symbols: ["BTCUSDT"] };
const binding = testnetAccountBinding("test-key");
const backingBaseline = { USDT: "10000", BTC: "1" };
const saved = { policy, accountBinding: binding, backingBaseline };
function fixture(details: unknown[] = []) {
  const execute = vi.fn(async (query: SqlQuery) => {
    if (query.text.startsWith("SELECT details")) return { rows: details, rowCount: details.length };
    if (query.text.startsWith("SELECT\n"))
      return { rows: [{ engaged: true, fresh: true }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const db = {
    execute,
    transaction: async <T>(work: (sql: { execute: typeof execute }) => Promise<T>) =>
      work({ execute })
  };
  return { execute, db, repo: createTestnetAllocationRepository(db) };
}
describe("immutable audited allocation", () => {
  it("never stores the API key in the binding", () => {
    expect(binding).toMatch(/^[a-f0-9]{64}$/);
    expect(() => testnetAccountBinding(undefined)).toThrow();
  });
  it("allows full-wallet defaults only without persisted allocation", async () => {
    await fixture().repo.assertPolicy(undefined);
    await expect(fixture([{ details: saved }]).repo.assertPolicy(undefined)).rejects.toThrow(
      "drift"
    );
  });
  it("requires initialization and matching account/config", async () => {
    await expect(fixture().repo.assertPolicy(policy, binding)).rejects.toThrow("initialization");
    const f = fixture([{ details: saved }]);
    await f.repo.assertPolicy(policy, binding);
    await expect(
      f.repo.assertPolicy({ ...policy, initialQuote: "101" }, binding)
    ).rejects.toThrow();
    await expect(
      f.repo.assertPolicy(policy, testnetAccountBinding("another-key"))
    ).rejects.toThrow();
  });
  it("audits initialization under the shared risk lock without resetting kill or equity", async () => {
    const f = fixture();
    await f.repo.initialize({
      database: f.db,
      policy,
      accountBinding: binding,
      actor: "operator",
      excludedWalletAssets: ["FAUCET"],
      backingBaseline
    });
    expect(f.execute.mock.calls[0]![0].text).toContain("pg_advisory_xact_lock(3140034)");
    const queries = f.execute.mock.calls.map(([q]) => q);
    expect(queries.at(-1)!.text).toContain("testnet-allocation-created");
    expect(JSON.parse(String(queries.at(-1)!.values[1]))).toMatchObject({
      policy,
      excludedWalletAssets: ["FAUCET"]
    });
    expect(queries.some((q) => q.text.startsWith("UPDATE"))).toBe(false);
  });
  it("is idempotent but refuses changing an existing policy", async () => {
    const f = fixture([{ details: saved }]);
    const options = {
      database: f.db,
      policy,
      accountBinding: binding,
      actor: "operator",
      excludedWalletAssets: [],
      backingBaseline
    };
    await f.repo.initialize(options);
    expect(f.execute.mock.calls.some(([q]) => q.text.startsWith("INSERT"))).toBe(false);
    await expect(
      f.repo.initialize({ ...options, policy: { ...policy, id: "new" } })
    ).rejects.toThrow("immutable");
  });
  it("rejects ambiguous or malformed persisted state", async () => {
    await expect(
      fixture([{ details: saved }, { details: saved }]).repo.assertPolicy(policy, binding)
    ).rejects.toThrow("unavailable");
    await expect(
      fixture([{ details: { ...saved, backingBaseline: { BTC: "NaN" } } }]).repo.backingBaseline()
    ).rejects.toThrow("unavailable");
    expect(await fixture([{ details: saved }]).repo.policy()).toEqual(policy);
  });
  it.each([
    { engaged: false, fresh: true },
    { engaged: true, fresh: false }
  ])("requires an engaged, fresh ledger: %j", async (row) => {
    const f = fixture();
    f.execute.mockImplementation(async (q) =>
      q.text.startsWith("SELECT\n") ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 1 }
    );
    await expect(
      f.repo.initialize({
        database: f.db,
        policy,
        accountBinding: binding,
        actor: "operator",
        excludedWalletAssets: [],
        backingBaseline
      })
    ).rejects.toThrow("fresh");
    expect(f.execute.mock.calls.some(([q]) => q.text.startsWith("INSERT"))).toBe(false);
  });
});
