import { useMemo, useState } from "react";
import { TopBar } from "../components/terminal/TopBar.js";
import { DashboardPage } from "../features/dashboard/DashboardPage.js";
import type { StrategyControlState } from "../lib/api-client.js";

export function AppShell() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [strategyState, setStrategyState] = useState<readonly StrategyControlState[]>([]);
  const connected = true;
  const shellTitle = useMemo(() => activeTab.toLowerCase(), [activeTab]);

  return (
    <div className="terminal-shell" data-page={shellTitle}>
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        connected={connected}
        totalEquity="100.0035"
        todayPnl="+0.0035"
      />
      {activeTab === "Dashboard" ? (
        <DashboardPage onStrategyState={setStrategyState} externalStrategies={strategyState} />
      ) : (
        <main className="placeholder-page">
          <div>
            <span>{activeTab}</span>
            <h1>{activeTab} workspace</h1>
            <p>
              This surface is reserved for the production Meridian workstation. Dashboard is the
              first fully wired slice.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
