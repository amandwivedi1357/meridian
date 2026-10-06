import { z } from "zod";
import {
  BinanceSignedRequestError,
  createAuthenticatedHttp,
  type AuthenticatedHttpOptions,
  type AuthenticatedHttpRequest
} from "./authenticated-http.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";
import {
  openOrdersSchema,
  orderLookupSchema,
  orderResponseSchema,
  placeOrderSchema,
  type BinanceOrderResponse,
  type OpenOrdersParams,
  type OrderLookupParams,
  type PlaceOrderParams
} from "./order-schemas.js";

export interface OrderClientOptions extends AuthenticatedHttpOptions {
  readonly rateLimiter?: Pick<TokenBucketRateLimiter, "acquire">;
}

export function createBinanceOrderClient(options: OrderClientOptions) {
  const http = createAuthenticatedHttp(options);
  const rateLimiter =
    options.rateLimiter ??
    new TokenBucketRateLimiter({
      capacity: 1_200,
      refillIntervalMs: 60_000
    });

  async function send(request: AuthenticatedHttpRequest, weight: number): Promise<unknown> {
    await rateLimiter.acquire(weight);
    return http.request<unknown>(request);
  }

  function readOrder(
    value: unknown,
    expected: OrderLookupParams,
    cancel = false
  ): BinanceOrderResponse {
    const parsed = orderResponseSchema.safeParse(value);
    if (!parsed.success) throw new BinanceSignedRequestError("unknown");
    const order = parsed.data;
    const responseClientId = cancel ? order.origClientOrderId : order.clientOrderId;
    if (order.symbol !== expected.symbol || responseClientId !== expected.clientOrderId) {
      throw new BinanceSignedRequestError("unknown");
    }
    return order;
  }

  return {
    async placeOrder(input: PlaceOrderParams): Promise<BinanceOrderResponse> {
      const parsed = placeOrderSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid place-order parameters");
      const order = parsed.data;
      const response = await send(
        {
          method: "POST",
          path: "/api/v3/order",
          parameters: {
            symbol: order.symbol,
            side: order.side,
            type: order.type,
            quantity: order.quantity,
            newClientOrderId: order.clientOrderId,
            newOrderRespType: "FULL",
            ...(order.type === "LIMIT"
              ? { price: order.price, timeInForce: order.timeInForce }
              : {})
          }
        },
        1
      );
      const result = readOrder(response, order);
      if (result.side !== order.side || result.type !== order.type) {
        throw new BinanceSignedRequestError("unknown");
      }
      return result;
    },

    async cancelOrder(input: OrderLookupParams): Promise<BinanceOrderResponse> {
      const order = parseLookup(input);
      return readOrder(
        await send(
          {
            method: "DELETE",
            path: "/api/v3/order",
            parameters: { symbol: order.symbol, origClientOrderId: order.clientOrderId }
          },
          1
        ),
        order,
        true
      );
    },

    async queryOrder(input: OrderLookupParams): Promise<BinanceOrderResponse> {
      const order = parseLookup(input);
      return readOrder(
        await send(
          {
            method: "GET",
            path: "/api/v3/order",
            parameters: { symbol: order.symbol, origClientOrderId: order.clientOrderId }
          },
          4
        ),
        order
      );
    },

    async openOrders(input: OpenOrdersParams = {}): Promise<readonly BinanceOrderResponse[]> {
      const parsed = openOrdersSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid open-orders parameters");
      const { symbol } = parsed.data;
      const response = await send(
        {
          method: "GET",
          path: "/api/v3/openOrders",
          parameters: { symbol }
        },
        symbol === undefined ? 80 : 6
      );
      const orders = z.array(orderResponseSchema).safeParse(response);
      if (
        !orders.success ||
        orders.data.some((order) => symbol !== undefined && order.symbol !== symbol)
      ) {
        throw new BinanceSignedRequestError("unknown");
      }
      return orders.data;
    }
  };
}

function parseLookup(input: OrderLookupParams): OrderLookupParams {
  const parsed = orderLookupSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid order-lookup parameters");
  return parsed.data;
}
