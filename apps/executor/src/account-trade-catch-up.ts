import { Decimal, type OrderReconciliationReport, type OrderState } from "@meridian/core";
import type { BinanceAccountTrade } from "@meridian/binance-client";
import type { OrderExecutionUpdateRecord } from "@meridian/db";

export interface AccountTradeCatchUpClient {
  readonly getAccountTrades: (input: {
    readonly symbol: string;
    readonly orderId: string;
  }) => Promise<readonly BinanceAccountTrade[]>;
}

export interface AccountTradeCatchUpStore {
  readonly recordOrderExecutionUpdate: (record: OrderExecutionUpdateRecord) => Promise<void>;
}

export interface AccountTradeCatchUpResult {
  readonly ordersChecked: number;
  readonly tradesFetched: number;
  readonly fillsPersisted: number;
}

export async function runAccountTradeCatchUp(options: {
  readonly report: OrderReconciliationReport;
  readonly accountTrades: AccountTradeCatchUpClient;
  readonly store: AccountTradeCatchUpStore;
}): Promise<AccountTradeCatchUpResult> {
  const orders = reconciliationOrdersWithExchangeIds(options.report);
  let tradesFetched = 0;
  let fillsPersisted = 0;

  for (const order of orders) {
    const trades = await options.accountTrades.getAccountTrades({
      symbol: order.symbol,
      orderId: order.exchangeOrderId
    });
    const orderedTrades = sortAndDedupeTrades(
      trades.filter((trade) => trade.orderId === order.exchangeOrderId)
    );
    tradesFetched += orderedTrades.length;

    let executedQuantity = new Decimal(0);
    let cumulativeQuoteQuantity = new Decimal(0);

    for (const trade of orderedTrades) {
      executedQuantity = executedQuantity.plus(trade.quantity);
      cumulativeQuoteQuantity = cumulativeQuoteQuantity.plus(trade.quoteQuantity);
      await options.store.recordOrderExecutionUpdate({
        clientOrderId: order.clientOrderId,
        exchangeOrderId: order.exchangeOrderId,
        state: executionStateForCatchUp(order.exchangeStatus),
        executedQuantity: executedQuantity.toString(),
        cumulativeQuoteQuantity: cumulativeQuoteQuantity.toString(),
        exchangeEventTimeMs: trade.eventTimeMs,
        executionId: `rest:${trade.tradeId}`,
        fill: {
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity.toString(),
          price: trade.price.toString(),
          fee: trade.commission.toString(),
          feeAsset: trade.commissionAsset
        }
      });
      fillsPersisted += 1;
    }
  }

  return {
    ordersChecked: orders.length,
    tradesFetched,
    fillsPersisted
  };
}

function reconciliationOrdersWithExchangeIds(report: OrderReconciliationReport): readonly {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly exchangeOrderId: string;
  readonly exchangeStatus: string;
}[] {
  return [...report.matched, ...report.terminalOnExchange];
}

function sortAndDedupeTrades(
  trades: readonly BinanceAccountTrade[]
): readonly BinanceAccountTrade[] {
  const seen = new Set<string>();
  return [...trades]
    .sort((left, right) => {
      if (left.eventTimeMs !== right.eventTimeMs) return left.eventTimeMs - right.eventTimeMs;
      return left.tradeId.localeCompare(right.tradeId);
    })
    .filter((trade) => {
      if (seen.has(trade.tradeId)) return false;
      seen.add(trade.tradeId);
      return true;
    });
}

function executionStateForCatchUp(
  status: string
): Extract<
  OrderState,
  "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" | "UNKNOWN"
> {
  if (status === "FILLED" || status === "CANCELED" || status === "REJECTED" || status === "EXPIRED") {
    return status;
  }

  return "PARTIALLY_FILLED";
}
