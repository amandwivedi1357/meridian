import { ShieldCheck } from "lucide-react";
import { MetricBadge } from "./MetricBadge.js";

const tickers = [
  { symbol: "BTC/USDT", value: "94,218.6", change: "+2.34%", positive: true },
  { symbol: "ETH/USDT", value: "3,177.42", change: "+1.56%", positive: true },
  { symbol: "SOL/USDT", value: "142.33", change: "+3.21%", positive: true },
  { symbol: "XRP/USDT", value: "0.5186", change: "-1.27%", positive: false }
];

export function TopBar({
  activeTab,
  onTabChange,
  connected,
  totalEquity,
  todayPnl
}: {
  readonly activeTab: string;
  readonly onTabChange: (tab: string) => void;
  readonly connected: boolean;
  readonly totalEquity: string;
  readonly todayPnl: string;
}) {
  const tabs = ["Dashboard", "Strategies", "Analytics", "Settings"];

  return (
    <header className="terminal-topbar">
      <div className="topbar-brand">
        <span className="brand-mark">M</span>
        <strong>MERIDIAN</strong>
      </div>
      <nav className="terminal-tabs" aria-label="Primary">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>
      <div className="ticker-strip" aria-label="Market tickers">
        {tickers.map((ticker) => (
          <span key={ticker.symbol}>
            <b>{ticker.symbol}</b>
            {ticker.value}
            <em className={ticker.positive ? "positive" : "negative"}>{ticker.change}</em>
          </span>
        ))}
      </div>
      <div className="account-strip">
        <MetricBadge label="Total equity" value={totalEquity} />
        <MetricBadge label="Today PnL" value={todayPnl} tone={todayPnl.startsWith("-") ? "negative" : "positive"} />
      </div>
      <div className={connected ? "connection connected" : "connection disconnected"}>
        <ShieldCheck size={14} />
        {connected ? "System Connected" : "Connection Lost"}
      </div>
      <div className="operator-label">admin@meridian.local</div>
    </header>
  );
}
