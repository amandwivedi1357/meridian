import { createHash } from "node:crypto";
import { parseTestnetAllocation, type TestnetAllocation } from "@meridian/core";
import type { OrderWriteAheadRepositoryDeps } from "./order-write-ahead-repository.js";
import type { RiskSqlDatabase } from "./risk-repository.js";

export function testnetAccountBinding(apiKey: string | undefined): string {
  if (!apiKey?.trim()) throw new Error("Allocation account binding unavailable");
  return createHash("sha256").update(apiKey).digest("hex");
}
export function createTestnetAllocationRepository(db: OrderWriteAheadRepositoryDeps) {
  async function read(sql = db) {
    const result = await sql.execute({
      text: `SELECT action, details FROM audit_log
        WHERE action IN ('testnet-allocation-created', 'testnet-allocation-rebaseline')
        ORDER BY id`,
      values: []
    });
    if (!result.rows) throw new Error("Allocation policy state unavailable");
    if (!result.rows.length) return null;
    const records = result.rows.map(readPersistedAllocationEvent);
    if (records.filter((record) => record.action === "testnet-allocation-created").length !== 1) {
      throw new Error("Allocation policy state unavailable");
    }
    const [created, ...updates] = records;
    if (created?.action !== "testnet-allocation-created")
      throw new Error("Allocation policy state unavailable");
    const latest = updates.at(-1)?.allocation ?? created.allocation;
    for (const record of updates) {
      if (
        record.action !== "testnet-allocation-rebaseline" ||
        record.allocation.accountBinding !== created.allocation.accountBinding ||
        JSON.stringify(record.allocation.policy) !== JSON.stringify(created.allocation.policy)
      ) {
        throw new Error("Allocation policy state unavailable");
      }
    }
    return latest;
  }
  async function assertPolicy(expected: TestnetAllocation | undefined, binding?: string) {
    const saved = await read();
    if (!saved && !expected) return;
    if (
      !saved ||
      !expected ||
      saved.accountBinding !== binding ||
      JSON.stringify(saved.policy) !== JSON.stringify(parseTestnetAllocation(expected))
    )
      throw new Error("Allocation configuration/account drift or initialization required");
  }
  return {
    assertPolicy,
    async policy() {
      return (await read())?.policy;
    },
    async backingBaseline() {
      const saved = await read();
      if (!saved) throw new Error("Allocation initialization required");
      return saved.backingBaseline;
    },
    async initialize(options: {
      database: RiskSqlDatabase;
      policy: TestnetAllocation;
      accountBinding: string;
      actor: string;
      excludedWalletAssets: readonly string[];
      backingBaseline: Record<string, string>;
    }) {
      const policy = parseTestnetAllocation(options.policy);
      if (
        !options.actor.trim() ||
        !/^[a-f0-9]{64}$/.test(options.accountBinding) ||
        !Object.keys(options.backingBaseline).length ||
        Object.values(options.backingBaseline).some((value) => !/^\d+(\.\d+)?$/.test(value))
      )
        throw new Error("Allocation requires actor, account binding and backing baseline");
      await options.database.transaction(async (tx) => {
        await tx.execute({ text: "SELECT pg_advisory_xact_lock(3140034)", values: [] });
        const saved = await read(tx);
        if (saved) {
          if (
            saved.accountBinding !== options.accountBinding ||
            JSON.stringify(saved.policy) !== JSON.stringify(policy)
          )
            throw new Error("Allocation is immutable; audited re-baseline required");
          return;
        }
        const result = await tx.execute({
          text: `SELECT
          (SELECT engaged FROM risk_control_state WHERE scope = 'global') AS engaged,
          NOT EXISTS (SELECT 1 FROM orders) AND NOT EXISTS (SELECT 1 FROM risk_reservations)
          AND NOT EXISTS (SELECT 1 FROM risk_equity_state) AS fresh`,
          values: []
        });
        const row = result.rows?.[0] as { engaged?: boolean; fresh?: boolean } | undefined;
        if (row?.engaged !== true || row.fresh !== true)
          throw new Error(
            "Allocation initialization requires engaged kill switch and fresh order/risk ledger"
          );
        const inserted = await tx.execute({
          text: "INSERT INTO audit_log (actor, action, details) VALUES ($1, 'testnet-allocation-created', $2::jsonb)",
          values: [
            options.actor,
            JSON.stringify({
              policy,
              accountBinding: options.accountBinding,
              backingBaseline: options.backingBaseline,
              excludedWalletAssets: [...options.excludedWalletAssets].sort(),
              scope: "single dedicated Testnet portfolio; wallet backing, not full-wallet equity"
            })
          ]
        });
        if (inserted.rowCount !== 1) throw new Error("Allocation audit write failed");
      });
    },
    async rebaseline(options: {
      database: RiskSqlDatabase;
      policy: TestnetAllocation;
      accountBinding: string;
      actor: string;
      reason: string;
      excludedWalletAssets: readonly string[];
      backingBaseline: Record<string, string>;
    }) {
      const policy = parseTestnetAllocation(options.policy);
      validateAllocationAuditInput({
        actor: options.actor,
        accountBinding: options.accountBinding,
        backingBaseline: options.backingBaseline
      });
      if (!options.reason.trim()) throw new Error("Rebaseline requires a reason");

      await options.database.transaction(async (tx) => {
        await tx.execute({ text: "SELECT pg_advisory_xact_lock(3140034)", values: [] });
        const saved = await read(tx);
        if (
          !saved ||
          saved.accountBinding !== options.accountBinding ||
          JSON.stringify(saved.policy) !== JSON.stringify(policy)
        ) {
          throw new Error("Allocation configuration/account drift or initialization required");
        }
        const inserted = await tx.execute({
          text: "INSERT INTO audit_log (actor, action, details) VALUES ($1, 'testnet-allocation-rebaseline', $2::jsonb)",
          values: [
            options.actor,
            JSON.stringify({
              policy,
              accountBinding: options.accountBinding,
              previousBackingBaseline: saved.backingBaseline,
              backingBaseline: options.backingBaseline,
              excludedWalletAssets: [...options.excludedWalletAssets].sort(),
              reason: options.reason,
              scope: "audited Testnet backing baseline update; policy and ledger unchanged"
            })
          ]
        });
        if (inserted.rowCount !== 1) throw new Error("Allocation rebaseline audit write failed");
      });
    },
    async listManagedOrders() {
      const result = await db.execute({
        text: "SELECT client_order_id, symbol FROM orders",
        values: []
      });
      if (!result.rows) throw new Error("Managed order identities unavailable");
      return result.rows.map((value) => {
        const row = value as { client_order_id?: unknown; symbol?: unknown };
        if (typeof row.client_order_id !== "string" || typeof row.symbol !== "string")
          throw new Error("Invalid managed order identity");
        return { clientOrderId: row.client_order_id, symbol: row.symbol };
      });
    }
  };
}

function validateAllocationAuditInput(options: {
  actor: string;
  accountBinding: string;
  backingBaseline: Record<string, string>;
}) {
  if (
    !options.actor.trim() ||
    !/^[a-f0-9]{64}$/.test(options.accountBinding) ||
    !Object.keys(options.backingBaseline).length ||
    Object.values(options.backingBaseline).some((value) => !/^\d+(\.\d+)?$/.test(value))
  ) {
    throw new Error("Allocation requires actor, account binding and backing baseline");
  }
}

function readPersistedAllocationEvent(value: unknown): {
  action: "testnet-allocation-created" | "testnet-allocation-rebaseline";
  allocation: {
    policy: TestnetAllocation;
    accountBinding: string;
    backingBaseline: Record<string, string>;
  };
} {
  if (typeof value !== "object" || value === null) throw new Error("Invalid persisted allocation");
  const row = value as { action?: unknown; details?: unknown };
  if (row.action !== "testnet-allocation-created" && row.action !== "testnet-allocation-rebaseline")
    throw new Error("Invalid persisted allocation");
  const details = row.details;
  if (typeof details !== "object" || details === null || Array.isArray(details))
    throw new Error("Invalid persisted allocation");
  const record = details as Record<string, unknown>;
  if (typeof record.accountBinding !== "string") throw new Error("Invalid persisted allocation");
  const baseline = record.backingBaseline;
  if (
    typeof baseline !== "object" ||
    baseline === null ||
    Array.isArray(baseline) ||
    Object.values(baseline).some(
      (entry) => typeof entry !== "string" || !/^\d+(\.\d+)?$/.test(entry)
    )
  ) {
    throw new Error("Allocation backing baseline unavailable");
  }

  return {
    action: row.action,
    allocation: {
      policy: parseTestnetAllocation(record.policy),
      accountBinding: record.accountBinding,
      backingBaseline: baseline as Record<string, string>
    }
  };
}
