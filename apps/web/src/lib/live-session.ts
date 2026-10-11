import {
  ApiError,
  getAccountSummary,
  getMarketSnapshot,
  getSession,
  getTradingState,
  getJson,
  type MarketEvent,
  type MarketSnapshot,
  type Principal,
  type TradingState
} from "./api-client.js";
import {
  marketFromSnapshot,
  parseAccount,
  reduceMarket,
  useTerminalStore
} from "./terminal-store.js";
import { parseHealth } from "../features/dashboard/health-model.js";

interface Source {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  onerror: ((event: Event) => void) | null;
  close(): void;
}
export interface LiveDependencies {
  snapshot: (interval: string, signal: AbortSignal) => Promise<MarketSnapshot>;
  account: (signal: AbortSignal) => Promise<TradingState>;
  session: () => Promise<{ principal: Principal }>;
  source: (url: string) => Source;
  frame: (callback: () => void) => () => void;
  health?: (signal: AbortSignal) => Promise<unknown>;
}
const defaults: LiveDependencies = {
  snapshot: getMarketSnapshot,
  account: async (signal) => {
    const [state, summary] = await Promise.all([
      getTradingState(signal),
      getAccountSummary(signal)
    ]);
    return { ...state, portfolio: summary.portfolio };
  },
  session: getSession,
  source: (url) => new EventSource(url, { withCredentials: true }),
  health: (signal) => getJson("/api/system/health", signal),
  frame: (callback) => {
    let fired = false;
    const run = () => {
      if (!fired) {
        fired = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        callback();
      }
    };
    const frame = requestAnimationFrame(run),
      timer = setTimeout(run, 250);
    return () => {
      fired = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }
};
export function startLiveSession(interval: string, deps: LiveDependencies = defaults) {
  const controller = new AbortController();
  let stopped = false;
  useTerminalStore.getState().reset();
  function acceptHealth(value: unknown) {
    const health = parseHealth(value);
    if (health.checkedAt > Date.now() + 5000) throw new Error("invalid_health");
    const current = useTerminalStore.getState().health;
    if (!current || health.checkedAt >= current.checkedAt) useTerminalStore.setState({ health });
  }
  const channels = (["market", "account"] as const).map((kind) => {
    let source: Source | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      heartbeatTimer: ReturnType<typeof setInterval> | undefined,
      cancelFrame: (() => void) | undefined;
    let lastReceiptAt = 0;
    let cursor = "",
      attempt = 0,
      epoch = 0,
      queued: { id: string; events: unknown[] }[] = [],
      bytes = 0;
    const status = (value: "live" | "connecting" | "reconnecting" | "unavailable") =>
      useTerminalStore.setState({
        [kind === "market" ? "marketConnection" : "accountConnection"]: value
      });
    function received() {
      lastReceiptAt = Date.now();
      const transport = useTerminalStore.getState().transport;
      useTerminalStore.setState({
        transport: {
          ...transport,
          [kind]: { ...transport[kind], lastReceivedAt: Date.now() }
        }
      });
    }
    function close() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      source?.close();
      source = undefined;
      cancelFrame?.();
      cancelFrame = undefined;
      queued = [];
      bytes = 0;
    }
    function stop() {
      epoch++;
      clearTimeout(timer);
      close();
    }
    function unauthorized() {
      if (stopped) return;
      useTerminalStore.getState().setSession(null, "required");
      controller.abort();
      stopped = true;
      for (const c of channels) c.stop();
    }
    function recover(fresh: boolean) {
      if (stopped) return;
      epoch++;
      close();
      clearTimeout(timer);
      status("reconnecting");
      const transport = useTerminalStore.getState().transport;
      useTerminalStore.setState({
        transport: {
          ...transport,
          [kind]: { ...transport[kind], reconnects: transport[kind].reconnects + 1 }
        }
      });
      if (fresh) {
        cursor = "";
        useTerminalStore.setState(
          kind === "market"
            ? { market: { candles: [], trades: [], book: null, updatedAt: null } }
            : { account: null }
        );
      }
      timer = setTimeout(
        () => {
          void connect();
        },
        Math.min(15000, 1000 * 2 ** Math.min(attempt++, 4))
      );
    }
    function flush() {
      cancelFrame = undefined;
      if (stopped) return;
      try {
        if (kind === "market")
          useTerminalStore.setState({
            market: reduceMarket(
              useTerminalStore.getState().market,
              queued.flatMap((b) => b.events) as MarketEvent[],
              interval
            )
          });
        else {
          const latest = queued.at(-1)?.events.at(-1);
          if (latest) {
            const account = parseAccount(latest);
            const current = useTerminalStore.getState().account;
            if (!current || account.checkedAt >= current.checkedAt)
              useTerminalStore.setState({ account });
          }
        }
        cursor = queued.at(-1)?.id ?? cursor;
        queued = [];
        bytes = 0;
        attempt = 0;
        status("live");
      } catch {
        recover(true);
      }
    }
    async function connect() {
      if (stopped) return;
      const own = epoch;
      try {
        if (!cursor) {
          if (kind === "market") {
            const snapshot = await deps.snapshot(interval, controller.signal);
            if (stopped || own !== epoch) return;
            useTerminalStore.setState({ market: marketFromSnapshot(snapshot, interval) });
            cursor = snapshot.cursor;
          } else {
            const account = await deps.account(controller.signal);
            if (stopped || own !== epoch) return;
            useTerminalStore.setState({ account: parseAccount(account) });
          }
        }
        if (stopped || own !== epoch) return;
        const opened = deps.source(
          `/api/stream/${kind}?symbol=BTCUSDT&interval=${encodeURIComponent(interval)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
        );
        source = opened;
        const valid = () => !stopped && source === opened && own === epoch;
        lastReceiptAt = Date.now();
        // Proxies can leave a dead SSE response open without firing EventSource.onerror.
        heartbeatTimer = setInterval(() => {
          if (valid() && Date.now() - lastReceiptAt >= 45000) recover(attempt >= 1);
        }, 5000);
        opened.addEventListener("ready", (event) => {
          if (valid()) {
            received();
            cursor = event.lastEventId || cursor;
            status("live");
          }
        });
        opened.addEventListener("heartbeat", () => {
          if (valid()) received();
        });
        if (kind === "account")
          opened.addEventListener("health", (event) => {
            if (!valid()) return;
            try {
              if (typeof event.data !== "string" || event.data.length > 64 * 1024)
                throw new Error("invalid_health");
              acceptHealth(JSON.parse(event.data));
              received();
            } catch {
              useTerminalStore.setState({ health: null });
            }
          });
        opened.addEventListener(kind, (event) => {
          if (!valid()) return;
          try {
            if (
              typeof event.data !== "string" ||
              event.data.length > 256 * 1024 ||
              !event.lastEventId
            )
              throw new Error("invalid_frame");
            const batch = JSON.parse(event.data);
            if (!Array.isArray(batch.events) || batch.events.length > 1000)
              throw new Error("invalid_batch");
            bytes += event.data.length;
            if (bytes > 1024 * 1024 || queued.length >= 50)
              throw new Error("client_buffer_capacity");
            queued.push({ id: event.lastEventId, events: batch.events });
            received();
            if (!cancelFrame) cancelFrame = deps.frame(flush);
          } catch {
            recover(true);
          }
        });
        opened.addEventListener("resync", () => {
          if (valid()) recover(true);
        });
        opened.onerror = () => {
          if (!valid()) return;
          close();
          status("reconnecting");
          void deps
            .session()
            .then(() => {
              if (!stopped && own === epoch) recover(attempt >= 1);
            })
            .catch((error) => {
              if (stopped || own !== epoch) return;
              if (error instanceof ApiError && error.status === 401) unauthorized();
              else recover(attempt >= 1);
            });
        };
      } catch (error) {
        if (stopped || own !== epoch) return;
        if (error instanceof ApiError && error.status === 401) unauthorized();
        else recover(true);
      }
    }
    return { stop, connect };
  });
  for (const channel of channels) void channel.connect();
  void deps
    .health?.(controller.signal)
    .then((value) => {
      if (!stopped) acceptHealth(value);
    })
    .catch(() => {});
  return () => {
    stopped = true;
    controller.abort();
    for (const channel of channels) channel.stop();
  };
}
