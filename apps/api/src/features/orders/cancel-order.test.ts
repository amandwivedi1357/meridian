import Fastify from "fastify";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { registerApiAuth } from "../../app/auth.js";
import { registerCancelOrderRoute, type CancelOrderClient } from "./cancel-order.js";

const viewerToken = "viewer-token-12345678901234567890";
const operatorToken = "operator-token-123456789012345678";
const clientOrderId = "mrd_cancel_test_1";

describe("cancel order API", () => {
  function setup(
    options: { claimRows?: unknown[]; existingRows?: unknown[]; failCancel?: boolean } = {}
  ) {
    const server = Fastify();
    registerApiAuth(server, { viewerToken, operatorToken });
    const query = vi.fn(async (text: string) => {
      if (text.includes("WITH claimed")) return { rows: options.claimRows ?? [claimRow()] };
      if (text.includes("SELECT state FROM orders")) return { rows: options.existingRows ?? [] };
      return { rows: [], rowCount: 1 };
    });
    const client: CancelOrderClient = {
      queryOrder: vi.fn(async () => ({ ...cancelResponse(), status: "NEW" as const })),
      cancelOrder: vi.fn(async () => {
        if (options.failCancel) throw new Error("exchange unavailable");
        return cancelResponse();
      }),
      close: vi.fn()
    };
    const createClient = vi.fn(async () => client);
    registerCancelOrderRoute(server, { query } as unknown as Pool, createClient);
    return { server, query, client, createClient };
  }

  it("requires an operator token", async () => {
    const { server, client } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: cancelPayload()
      });
      expect(response.statusCode).toBe(403);
      expect(client.cancelOrder).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("marks the order pending cancel before asking Binance and persists the canceled response", async () => {
    const { server, query, client } = setup();
    try {
      const response = await server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: cancelPayload({ reason: " stale limit order " })
      });
      expect(response.statusCode).toBe(200);
      expect(query.mock.calls[0]).toEqual([
        expect.stringContaining("api-order-cancel-requested"),
        [clientOrderId, "PENDING_CANCEL", "operator-token", "stale limit order"]
      ]);
      expect(client.cancelOrder).toHaveBeenCalledWith({
        symbol: "BTCUSDT",
        clientOrderId
      });
      expect(query.mock.calls[1]).toEqual([
        expect.stringContaining("api-order-cancel-confirmed"),
        [
          clientOrderId,
          "2233001",
          "CANCELED",
          "0.00000",
          "0.0000000",
          1791898000000,
          "cancel:2233001:1791898000000",
          new Date(1791898000000),
          "operator-token",
          "stale limit order"
        ]
      ]);
      expect(response.json()).toMatchObject({
        status: "cancel-requested",
        order: {
          clientOrderId,
          symbol: "BTCUSDT",
          state: "CANCELED",
          exchangeOrderId: "2233001"
        }
      });
    } finally {
      await server.close();
    }
  });

  it("rejects missing, terminal and malformed cancellation requests before exchange I/O", async () => {
    const missing = setup({ claimRows: [], existingRows: [] });
    try {
      const response = await missing.server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: cancelPayload()
      });
      expect(response.statusCode).toBe(404);
      expect(missing.createClient).not.toHaveBeenCalled();
    } finally {
      await missing.server.close();
    }

    const terminal = setup({ claimRows: [], existingRows: [{ state: "FILLED" }] });
    try {
      const response = await terminal.server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: cancelPayload()
      });
      expect(response.statusCode).toBe(409);
      expect(terminal.createClient).not.toHaveBeenCalled();
    } finally {
      await terminal.server.close();
    }

    const malformed = setup();
    try {
      const response = await malformed.server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: cancelPayload({ confirm: "" })
      });
      expect(response.statusCode).toBe(400);
      expect(malformed.createClient).not.toHaveBeenCalled();
    } finally {
      await malformed.server.close();
    }
  });

  it("keeps the request sanitized when exchange cancellation fails", async () => {
    const { server } = setup({ failCancel: true });
    try {
      const response = await server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: cancelPayload()
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("exchange unavailable");
    } finally {
      await server.close();
    }
  });
  it("retries pending cancellation and queries before retrying; a terminal order is not canceled again", async () => {
    const f = setup({ claimRows: [{ ...claimRow(), state: "PENDING_CANCEL" }] });
    const cancel = vi.mocked(f.client.cancelOrder);
    cancel.mockRejectedValueOnce(new Error("ambiguous"));
    const post = () =>
      f.server.inject({
        method: "POST",
        url: `/api/orders/${clientOrderId}/cancel`,
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: cancelPayload()
      });
    try {
      expect((await post()).statusCode).toBe(503);
      expect((await post()).statusCode).toBe(200);
      expect(cancel).toHaveBeenCalledTimes(2);
      vi.mocked(f.client.queryOrder).mockResolvedValue(cancelResponse());
      expect((await post()).statusCode).toBe(200);
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(f.query.mock.calls[0]?.[0]).toContain("'PENDING_CANCEL'");
    } finally {
      await f.server.close();
    }
  });
});

function claimRow() {
  return {
    client_order_id: clientOrderId,
    symbol: "BTCUSDT",
    state: "PENDING_CANCEL"
  };
}

function cancelResponse() {
  return {
    symbol: "BTCUSDT",
    orderId: 2233001,
    orderListId: -1,
    clientOrderId,
    origClientOrderId: clientOrderId,
    price: "85000.00",
    origQty: "0.00008",
    executedQty: "0.00000",
    cummulativeQuoteQty: "0.0000000",
    status: "CANCELED" as const,
    timeInForce: "GTC" as const,
    type: "LIMIT" as const,
    side: "BUY" as const,
    updateTime: 1791898000000
  };
}

function cancelPayload(override: Partial<{ reason: string; confirm: string }> = {}) {
  return {
    reason: "cancel stale order",
    confirm: "CANCEL_ORDER",
    ...override
  };
}
