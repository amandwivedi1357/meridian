const panels = [
  "Market",
  "Strategies",
  "Orders",
  "Backtests",
  "System Health"
] as const;

export function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Meridian</p>
          <h1>Trading Console</h1>
        </div>
        <nav aria-label="Primary">
          {panels.map((panel) => (
            <button type="button" key={panel}>
              {panel}
            </button>
          ))}
        </nav>
      </aside>
      <section className="workspace" aria-label="Overview">
        <header>
          <p className="eyebrow">Phase 0</p>
          <h2>Foundation online</h2>
          <p>
            The dashboard shell is ready for live market data, strategy controls, orders,
            backtests, and system health views.
          </p>
        </header>
        <div className="metric-grid">
          <article>
            <span>Execution</span>
            <strong>Testnet only</strong>
          </article>
          <article>
            <span>Streams</span>
            <strong>Redis backed</strong>
          </article>
          <article>
            <span>Storage</span>
            <strong>TimescaleDB</strong>
          </article>
        </div>
      </section>
    </main>
  );
}
