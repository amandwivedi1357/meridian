import { Activity } from "lucide-react";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import { age, sampleFresh } from "./health-model.js";

export function SystemHealthPanel({ now }: { now: number }) {
  const { health, transport, market, marketConnection, accountConnection } = useTerminalStore();
  const fresh = sampleFresh(health, now);
  const marketStale = market.updatedAt === null || now - market.updatedAt > 15000;
  const tone = !fresh
    ? "amber"
    : health?.redis === "unavailable" || health?.database === "unavailable"
      ? "red"
      : marketStale || marketConnection !== "live" || accountConnection !== "live"
        ? "amber"
        : "green";
  return (
    <section
      className="system-health-panel"
      aria-label="System health"
      data-checked-at={health?.checkedAt}
    >
      <div className="panel-title">
        <span>
          <Activity size={14} /> System health
        </span>
        <StatusBadge tone={tone}>
          {!health
            ? "Waiting"
            : !fresh
              ? "Stale"
              : tone === "red"
                ? "Degraded"
                : marketStale
                  ? "Feed stale"
                  : tone === "amber"
                    ? "Reconnecting"
                    : "Connected"}
        </StatusBadge>
      </div>
      <dl className="health-readings">
        <dt>Market data age</dt>
        <dd className={marketStale ? "health-warning" : ""}>{age(market.updatedAt, now)}</dd>
        <dt>Market SSE / age</dt>
        <dd
          className={
            transport.market.lastReceivedAt === null ||
            now - transport.market.lastReceivedAt > 45000
              ? "health-warning"
              : ""
          }
        >
          {marketConnection === "live" &&
          transport.market.lastReceivedAt !== null &&
          now - transport.market.lastReceivedAt > 45000
            ? "stale"
            : marketConnection}{" "}
          / {age(transport.market.lastReceivedAt, now)}
        </dd>
        <dt>Account SSE / age</dt>
        <dd
          className={
            transport.account.lastReceivedAt === null ||
            now - transport.account.lastReceivedAt > 45000
              ? "health-warning"
              : ""
          }
        >
          {accountConnection === "live" &&
          transport.account.lastReceivedAt !== null &&
          now - transport.account.lastReceivedAt > 45000
            ? "stale"
            : accountConnection}{" "}
          / {age(transport.account.lastReceivedAt, now)}
        </dd>
        <dt>Reconnects / M · A</dt>
        <dd>
          {transport.market.reconnects} / {transport.account.reconnects}
        </dd>
        <dt>Redis</dt>
        <dd>{fresh ? health!.redis : "Unknown"}</dd>
        <dt>Database</dt>
        <dd>{fresh ? health!.database : "Unknown"}</dd>
        <dt>Health sample age</dt>
        <dd>{age(health?.checkedAt ?? null, now)}</dd>
      </dl>
      <h3>Consumer groups</h3>
      {health ? (
        <div className="health-groups">
          {health.streams.map((row) => (
            <div className="health-stream" key={row.stream}>
              <strong>{row.stream.replace(".BTCUSDT", "")}</strong>
              <small>
                {fresh ? row.status : "Stale"} / {row.length ?? "--"} entries
              </small>
              {row.groups.length ? (
                row.groups.map((group) => (
                  <dl className="health-readings" key={group.name}>
                    <dt>{group.name} / consumers</dt>
                    <dd>{fresh ? group.consumers : "--"}</dd>
                    <dt>Undelivered / pending</dt>
                    <dd>
                      {fresh ? (group.lag ?? "Unknown") : "--"} / {fresh ? group.pending : "--"}
                    </dd>
                  </dl>
                ))
              ) : (
                <small>
                  {row.status === "available" && fresh
                    ? "No consumer group"
                    : "Group status unknown"}
                </small>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="terminal-empty compact">Health unavailable</div>
      )}
    </section>
  );
}
