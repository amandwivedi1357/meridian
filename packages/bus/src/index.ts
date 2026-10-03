export const streams = {
  control: "control",
  orderCommands: "orders.commands",
  orderEvents: "orders.events",
  signals: "signals"
} as const;

export function marketTradeStream(symbol: string) {
  return `market.trade.${symbol}`;
}

export function marketKlineStream(symbol: string, interval: string) {
  return `market.kline.${symbol}.${interval}`;
}

export function marketBookStream(symbol: string) {
  return `market.book.${symbol}`;
}
