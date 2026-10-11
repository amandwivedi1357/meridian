import Fastify from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { registerBacktests } from "./backtests.js";

function fixture() {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  const query = vi.fn(async () => ({
    rows: [{ runId: "test", index: 0, equity: "100.00000001" }]
  }));
  registerBacktests(server, { query } as unknown as Pool);
  return { server, query };
}
describe("saved backtest REST", () => {
  it("renders escaped HTML reports with a sandboxed content policy", async () => {
    const { server, query } = fixture();
    query.mockResolvedValueOnce({ rows: [{}] } as never);
    query.mockResolvedValueOnce({
      rows: [
        {
          run_id: "test",
          strategy: "<script>alert(1)</script>",
          symbol: "BTCUSDT",
          interval: "15m",
          from_ms: "0",
          to_ms: "1000",
          created_at: new Date(0),
          metrics: {},
          params: {}
        }
      ]
    } as never);
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    try {
      const response = await server.inject({ url: "/api/backtests/test/report" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(response.body).toContain("&lt;script&gt;");
      expect(response.body).not.toContain("<script>");
      expect(query).toHaveBeenCalledWith(expect.stringContaining("LIMIT 10001"), ["test"]);
    } finally {
      await server.close();
    }
  });
  it("rejects oversized reports instead of silently truncating", async () => {
    const { server, query } = fixture();
    query.mockResolvedValueOnce({ rows: [{}] } as never);
    query.mockResolvedValueOnce({ rows: [{ run_id: "test" }] } as never);
    query.mockResolvedValueOnce({ rows: Array.from({ length: 10001 }, () => ({})) } as never);
    query.mockResolvedValueOnce({ rows: [] });
    try {
      expect((await server.inject({ url: "/api/backtests/test/report" })).statusCode).toBe(503);
    } finally {
      await server.close();
    }
  });
  it("lists saved runs with bounded input", async () => {
    const { server, query } = fixture();
    try {
      expect((await server.inject({ url: "/api/backtests?limit=10" })).json().runs[0].runId).toBe(
        "test"
      );
      expect(query.mock.calls[0]).toEqual([expect.stringContaining("backtest_runs"), [10]]);
      expect((await server.inject({ url: "/api/backtests?limit=1000" })).statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
  it("returns 404 for missing runs and 503 on storage failure", async () => {
    const { server, query } = fixture();
    try {
      query.mockResolvedValueOnce({ rows: [] });
      expect((await server.inject({ url: "/api/backtests/missing" })).statusCode).toBe(404);
      query.mockRejectedValueOnce(new Error("private connection detail"));
      const failed = await server.inject({ url: "/api/backtests/test" });
      expect(failed.statusCode).toBe(503);
      expect(failed.body).not.toContain("private");
    } finally {
      await server.close();
    }
  });
  it("paginates decimal-safe equity history with parameterized cursors", async () => {
    const { server, query } = fixture();
    try {
      const response = await server.inject({ url: "/api/backtests/test/equity?after=-1&limit=1" });
      expect(response.json()).toEqual({
        items: [{ runId: "test", index: 0, equity: "100.00000001" }],
        nextCursor: 0
      });
      expect(query.mock.calls[1]).toEqual([
        expect.stringContaining("point_index>$2"),
        ["test", -1, 1]
      ]);
      expect((await server.inject({ url: "/api/backtests/test/fills?after=NaN" })).statusCode).toBe(
        400
      );
    } finally {
      await server.close();
    }
  });
});
