import { useEffect, useState } from "react";
import { LogIn, LogOut, Radio } from "lucide-react";
import { MetricBadge } from "./MetricBadge.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { formatSignedUsd, formatUsd } from "../../lib/format.js";

export function TopBar({
  onSignIn,
  onSignOut,
  busy,
  pageLabel,
  instrumentLabel = "BTC/USDT"
}: {
  onSignIn: () => void;
  onSignOut: () => void;
  busy: boolean;
  pageLabel: string;
  instrumentLabel?: string;
}) {
  const { principal, market, account, marketConnection, accountConnection } = useTerminalStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale = market.updatedAt === null || now - market.updatedAt > 15000;
  const connected = !stale && marketConnection === "live" && accountConnection === "live";
  const pnl = account?.portfolio?.totals.find((t) => t.quoteAsset === "USDT")?.realizedPnl;
  const walletUsdt = account?.portfolio?.wallet?.assets.find((asset) => asset.asset === "USDT");
  const freeUsdt = walletUsdt?.total ?? null;
  const equity = account?.portfolio?.equity ?? walletUsdt?.value ?? walletUsdt?.total ?? null;
  const openBtc = account?.portfolio?.positions.find((position) => position.symbol === "BTCUSDT");
  return (
    <header className="terminal-topbar">
      <div className="topbar-brand">
        <span className="brand-mark">M</span>
        <strong>MERIDIAN</strong>
      </div>
      <span className="topbar-page">{pageLabel}</span>
      <div className="ticker-strip">
        <span>
          <b>{instrumentLabel}</b>
          {formatUsd(market.trades.at(-1)?.price)}
        </span>
      </div>
      <div className="account-strip">
        <MetricBadge label="Equity / USDT" value={formatUsd(equity)} />
        <MetricBadge label="Free USDT" value={formatUsd(freeUsdt)} />
        <MetricBadge label="Open BTC" value={openBtc?.quantity ?? "--"} />
        <MetricBadge label="Realized P/L" value={formatSignedUsd(pnl)} />
      </div>
      <div className={connected ? "connection connected" : "connection disconnected"}>
        <Radio size={14} />
        {!principal
          ? "Disconnected"
          : connected
            ? "Streaming"
            : stale && marketConnection === "live"
              ? "Market stale"
              : "Reconnecting"}
      </div>
      <div className="session-controls">
        <span>
          {principal?.actor === "local-viewer" ? "Local viewer" : (principal?.role ?? "Signed out")}
        </span>
        <button
          className="icon-button"
          title="Sign in"
          aria-label="Sign in"
          disabled={busy}
          onClick={onSignIn}
        >
          <LogIn size={16} />
        </button>
        {principal?.expiresAtMs && (
          <button
            className="icon-button"
            title="Sign out"
            aria-label="Sign out"
            disabled={busy}
            onClick={onSignOut}
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
