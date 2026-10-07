import { BinanceSignedRequestError } from "./authenticated-http.js";
import type { BinanceOrderResponse, OrderLookupParams, PlaceOrderParams } from "./order-schemas.js";

export interface QueryBeforeRetryOrderClient {
  readonly placeOrder: (input: PlaceOrderParams) => Promise<BinanceOrderResponse>;
  readonly queryOrder: (input: OrderLookupParams) => Promise<BinanceOrderResponse>;
}

export interface SafeOrderSubmissionResult {
  readonly order: BinanceOrderResponse;
  readonly source: "placement" | "query-after-unknown";
}

export function createQueryBeforeRetryOrderSubmitter(client: QueryBeforeRetryOrderClient) {
  return {
    async placeOrder(input: PlaceOrderParams): Promise<SafeOrderSubmissionResult> {
      try {
        return {
          order: await client.placeOrder(input),
          source: "placement"
        };
      } catch (error) {
        if (!(error instanceof BinanceSignedRequestError) || error.outcome !== "unknown") {
          throw error;
        }

        return {
          order: await client.queryOrder({
            symbol: input.symbol,
            clientOrderId: input.clientOrderId
          }),
          source: "query-after-unknown"
        };
      }
    }
  };
}
