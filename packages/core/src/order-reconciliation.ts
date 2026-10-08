import type { GatewayOrderSnapshot, GatewayOrderStatus } from "./exchange.js";
import type { OrderState } from "./order-lifecycle.js";

export interface LocalOrderForReconciliation {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly state: OrderState;
  readonly updatedAtMs: number;
}

export interface ReconciliationExchange {
  readonly getOrder: (request: {
    readonly symbol: string;
    readonly clientOrderId: string;
  }) => Promise<GatewayOrderSnapshot | null>;
}

export interface MatchedReconciliationItem {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly localState: OrderState;
  readonly exchangeStatus: GatewayOrderStatus;
  readonly exchangeOrderId: string;
}

export interface MissingOnExchangeReconciliationItem {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly localState: OrderState;
}

export interface TerminalOnExchangeReconciliationItem {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly localState: OrderState;
  readonly exchangeStatus: Extract<
    GatewayOrderStatus,
    "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED"
  >;
  readonly exchangeOrderId: string;
}

export interface QueryFailedReconciliationItem {
  readonly clientOrderId: string;
  readonly symbol: string;
  readonly localState: OrderState;
  readonly reason: string;
}
export interface OrderReconciliationStore {
  readonly listOrdersForReconciliation: () => Promise<
    readonly LocalOrderForReconciliation[]
  >;
}

export async function runOrderReconciliation(input: {
  readonly store: OrderReconciliationStore;
  readonly exchange: ReconciliationExchange;
}): Promise<OrderReconciliationReport> {
  const localOrders = await input.store.listOrdersForReconciliation();

  return reconcileOpenOrders({
    localOrders,
    exchange: input.exchange
  });
}

export interface OrderReconciliationReport {
  readonly checked: number;
  readonly matched: readonly MatchedReconciliationItem[];
  readonly missingOnExchange: readonly MissingOnExchangeReconciliationItem[];
  readonly terminalOnExchange: readonly TerminalOnExchangeReconciliationItem[];
  readonly queryFailed: readonly QueryFailedReconciliationItem[];
}

const terminalLocalStates: ReadonlySet<OrderState> = new Set([
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
]);

const terminalExchangeStatuses: ReadonlySet<GatewayOrderStatus> = new Set([
  "FILLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
]);

export async function reconcileOpenOrders(input: {
  readonly localOrders: readonly LocalOrderForReconciliation[];
  readonly exchange: ReconciliationExchange;
}): Promise<OrderReconciliationReport> {
  const matched: MatchedReconciliationItem[] = [];
  const missingOnExchange: MissingOnExchangeReconciliationItem[] = [];
  const terminalOnExchange: TerminalOnExchangeReconciliationItem[] = [];
  const queryFailed: QueryFailedReconciliationItem[] = [];

  const localOrdersToCheck = input.localOrders.filter(
    (order) => !terminalLocalStates.has(order.state)
  );

  for (const localOrder of localOrdersToCheck) {
    try {
      const exchangeOrder = await input.exchange.getOrder({
        symbol: localOrder.symbol,
        clientOrderId: localOrder.clientOrderId,
      });

      if (exchangeOrder === null) {
        missingOnExchange.push({
          clientOrderId: localOrder.clientOrderId,
          symbol: localOrder.symbol,
          localState: localOrder.state,
        });
        continue;
      }

      if (isTerminalExchangeStatus(exchangeOrder.status)) {
        terminalOnExchange.push({
          clientOrderId: localOrder.clientOrderId,
          symbol: localOrder.symbol,
          localState: localOrder.state,
          exchangeStatus: exchangeOrder.status,
          exchangeOrderId: exchangeOrder.exchangeOrderId,
        });
        continue;
      }

      matched.push({
        clientOrderId: localOrder.clientOrderId,
        symbol: localOrder.symbol,
        localState: localOrder.state,
        exchangeStatus: exchangeOrder.status,
        exchangeOrderId: exchangeOrder.exchangeOrderId,
      });
    } catch (error) {
      queryFailed.push({
        clientOrderId: localOrder.clientOrderId,
        symbol: localOrder.symbol,
        localState: localOrder.state,
        reason: error instanceof Error ? error.message : "Unknown reconciliation query failure",
      });
    }
  }

  return {
    checked: localOrdersToCheck.length,
    matched,
    missingOnExchange,
    terminalOnExchange,
    queryFailed,
  };
}

function isTerminalExchangeStatus(
  status: GatewayOrderStatus
): status is TerminalOnExchangeReconciliationItem["exchangeStatus"] {
  return terminalExchangeStatuses.has(status);
}
