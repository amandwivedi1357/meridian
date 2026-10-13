import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDialogFocus } from "../lib/use-dialog-focus.js";
import { TopBar } from "../components/terminal/TopBar.js";
import { WorkspacePage } from "../features/workspace/WorkspacePage.js";
import { NavigationRail } from "../components/terminal/NavigationRail.js";
import { pageFromHash, pages } from "./navigation.js";
import { BacktestsPage } from "../features/backtests/BacktestsPage.js";
import {
  ApiError,
  getMarketInstruments,
  getSession,
  login,
  logout,
  type MarketInstrument
} from "../lib/api-client.js";
import { startLiveSession } from "../lib/live-session.js";
import { instrumentCatalog } from "../lib/instrument-catalog.js";
import { useTerminalStore } from "../lib/terminal-store.js";
import { LogIn, X } from "lucide-react";

export function AppShell() {
  const [view, setView] = useState(() => pageFromHash(window.location.hash));
  useEffect(() => {
    const changed = () => setView(pageFromHash(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const session = useTerminalStore((s) => s.session),
    principal = useTerminalStore((s) => s.principal);
  const [interval, setInterval] = useState("15m"),
    [symbol, setSymbol] = useState("BTCUSDT"),
    [instruments, setInstruments] = useState<readonly MarketInstrument[]>([
      { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }
    ]),
    [loginOpen, setLoginOpen] = useState(false);
  const [credential, setCredential] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [instrumentError, setInstrumentError] = useState<string | null>(null);
  const [instrumentsLoading, setInstrumentsLoading] = useState(false);
  const [instrumentRevision, setInstrumentRevision] = useState(0);
  async function check() {
    const result = await getSession();
    useTerminalStore.getState().setSession(result.principal, "ready");
  }
  useEffect(() => {
    const controller = new AbortController();
    void getSession(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          useTerminalStore.getState().setSession(result.principal, "ready");
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          useTerminalStore
            .getState()
            .setSession(
              null,
              e instanceof ApiError && e.status === 401 ? "required" : "unavailable"
            );
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (session !== "ready") return;
    const stop = startLiveSession(interval, symbol);
    const expiry = principal?.expiresAtMs;
    const timer = expiry
      ? setTimeout(
          () => useTerminalStore.getState().setSession(null, "required"),
          Math.max(0, expiry - Date.now())
        )
      : undefined;
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [session, principal?.expiresAtMs, principal?.role, interval, symbol]);
  useEffect(() => {
    if (session !== "ready") return;
    const controller = new AbortController();
    setInstrumentsLoading(true);
    setInstrumentError(null);
    void getMarketInstruments("USDT", controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const catalog = instrumentCatalog(result);
        setInstruments(catalog);
        setSymbol((current) =>
          catalog.some((item) => item.symbol === current) ? current : catalog[0]!.symbol
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setInstrumentError(
            error instanceof ApiError && error.status === 404
              ? "Instrument catalog unavailable: API update required"
              : "Instrument list unavailable"
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setInstrumentsLoading(false);
      });
    return () => controller.abort();
  }, [session, instrumentRevision]);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const token = credential;
    setCredential("");
    try {
      await login(token);
      await check();
      setLoginOpen(false);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 503
          ? "Login is not configured"
          : e instanceof ApiError && e.status === 429
            ? "Too many attempts. Try again later"
            : "Sign-in failed"
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await logout();
      useTerminalStore.getState().setSession(null, "required");
    } catch {
      setError("Sign-out failed");
      setLoginOpen(true);
    } finally {
      setBusy(false);
    }
  }
  const needsLogin = session === "required" || loginOpen;
  const dialogRef = useRef<HTMLFormElement>(null);
  useDialogFocus(
    dialogRef,
    needsLogin,
    session === "ready" && !busy
      ? () => {
          setCredential("");
          setLoginOpen(false);
        }
      : undefined
  );
  return (
    <div className="terminal-shell">
      <NavigationRail view={view} />
      <TopBar
        instrumentLabel={(() => {
          const item = instruments.find((entry) => entry.symbol === symbol);
          return item ? `${item.baseAsset}/${item.quoteAsset}` : symbol;
        })()}
        onSignIn={() => {
          setError("");
          setLoginOpen(true);
        }}
        onSignOut={() => {
          void signOut();
        }}
        busy={busy}
        pageLabel={pages.find((p) => p.id === view)!.label}
      />
      {session === "ready" ? (
        view === "backtests" ? (
          <BacktestsPage />
        ) : (
          <WorkspacePage
            key={view}
            view={view}
            timeframe={interval}
            onTimeframe={setInterval}
            symbol={symbol}
            instruments={instruments}
            instrumentError={instrumentError}
            instrumentsLoading={instrumentsLoading}
            onRetryInstruments={() => setInstrumentRevision((value) => value + 1)}
            onSymbol={setSymbol}
          />
        )
      ) : (
        <main className="session-state" role="status">
          <h1>Meridian</h1>
          <p>
            {session === "checking"
              ? "Connecting"
              : session === "required"
                ? "Session required"
                : "API unavailable"}
          </p>
          {session === "unavailable" && (
            <button
              className="terminal-button terminal-button-primary"
              onClick={() => {
                void check().catch((e) =>
                  useTerminalStore
                    .getState()
                    .setSession(
                      null,
                      e instanceof ApiError && e.status === 401 ? "required" : "unavailable"
                    )
                );
              }}
            >
              Retry
            </button>
          )}
        </main>
      )}
      {needsLogin && (
        <div className="dialog-backdrop">
          <form
            ref={dialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
            onSubmit={signIn}
          >
            <div className="panel-title">
              <h2 id="login-title">Sign in to Meridian</h2>
              {session === "ready" && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close sign in"
                  title="Close"
                  disabled={busy}
                  onClick={() => {
                    setCredential("");
                    setLoginOpen(false);
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <label className="dialog-field">
              Dashboard credential
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
                minLength={32}
                maxLength={4096}
                disabled={busy}
              />
            </label>
            {error && (
              <p className="dialog-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button className="terminal-button terminal-button-primary" disabled={busy}>
                <LogIn size={15} /> {busy ? "Signing in" : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
