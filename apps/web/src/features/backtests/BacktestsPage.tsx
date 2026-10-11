import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { FlaskConical, Play, RefreshCw, ChevronDown } from "lucide-react";
import { backtestApi, type JobRequest } from "./backtest-api.js";
import { curves, rangeError, requestFor, shouldPoll } from "./backtest-model.js";
import { ResultChart } from "./ResultChart.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { ApiError } from "../../lib/api-client.js";
import { DataTable } from "../../components/terminal/DataTable.js";
import { formatUsd } from "../../lib/format.js";

const useBacktestState = create<{ selected: string; jobId: string; attempt: JobRequest | null }>(
  () => ({ selected: "", jobId: "", attempt: null })
);
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
function date(time: string) {
  const value = Number(time);
  return Number.isFinite(value) && value >= 0 && value < 8640000000000000
    ? new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC"
    : "--";
}
function metric(value: unknown, suffix = "") {
  return (typeof value === "string" || typeof value === "number") && Number.isFinite(Number(value))
    ? Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + suffix
    : "--";
}
const jobError = (reason: string | null) =>
  reason === "market_history_incomplete"
    ? "Stored candle history is incomplete for this range"
    : reason === "worker_timeout"
      ? "Simulation timed out"
      : reason
        ? reason.replaceAll("_", " ")
        : "Simulation failed";

export function BacktestsPage() {
  const principal = useTerminalStore((s) => s.principal),
    { selected, jobId, attempt } = useBacktestState();
  const actor = principal?.actor ?? "",
    operator = principal?.role === "operator";
  const client = useQueryClient(),
    submitting = useRef(false);
  const [from, setFrom] = useState(() => utcDay(Date.now() - 2 * 86400000)),
    [to, setTo] = useState(() => utcDay(Date.now() - 86400000)),
    [interval, setInterval] = useState<"15m" | "1h">("15m"),
    [validation, setValidation] = useState("");
  const runs = useQuery({
    queryKey: ["backtests", actor],
    queryFn: ({ signal }) => backtestApi.runs(signal),
    retry: 1,
    staleTime: 30000
  });
  const job = useQuery({
    queryKey: ["backtest-job", actor, jobId],
    queryFn: ({ signal }) => backtestApi.job(jobId, signal),
    enabled: !!jobId,
    retry: false,
    refetchInterval: (q) => shouldPoll(q.state.data?.job, q.state.error)
  });
  const active =
    !!jobId && (!job.data || job.data.job.state === "queued" || job.data.job.state === "running");
  const runId = selected || runs.data?.runs[0]?.runId || "";
  const detail = useQuery({
    queryKey: ["backtest-run", actor, runId],
    queryFn: ({ signal }) => backtestApi.run(runId, signal),
    enabled: !!runId,
    retry: 1,
    staleTime: 60000
  });
  const equity = useInfiniteQuery({
    queryKey: ["backtest-equity", actor, runId],
    queryFn: ({ signal, pageParam }) => backtestApi.equity(runId, pageParam, signal),
    initialPageParam: -1,
    getNextPageParam: (last, pages, after) =>
      pages.length < 10 && last.nextCursor !== null && last.nextCursor > after
        ? last.nextCursor
        : undefined,
    enabled: !!runId,
    retry: 1,
    staleTime: 60000
  });
  const fills = useInfiniteQuery({
    queryKey: ["backtest-fills", actor, runId],
    queryFn: ({ signal, pageParam }) => backtestApi.fills(runId, pageParam, signal),
    initialPageParam: -1,
    getNextPageParam: (last, pages, after) =>
      pages.length < 25 && last.nextCursor !== null && last.nextCursor > after
        ? last.nextCursor
        : undefined,
    enabled: !!runId,
    retry: 1,
    staleTime: 60000
  });
  useEffect(() => {
    if (equity.hasNextPage && !equity.isFetchingNextPage && !equity.isError)
      void equity.fetchNextPage();
  }, [equity.hasNextPage, equity.isFetchingNextPage, equity.isError, equity.fetchNextPage]);
  useEffect(() => {
    if (job.data?.job.state === "succeeded" && job.data.job.runId) {
      useBacktestState.setState({ selected: job.data.job.runId });
      void client.invalidateQueries({ queryKey: ["backtests", actor] });
    }
  }, [job.data?.job.state, job.data?.job.runId, client, actor]);
  const submit = useMutation({
    mutationFn: backtestApi.submit,
    retry: false,
    onSuccess: (result) => {
      useBacktestState.setState({ jobId: result.job.jobId, attempt: null });
    },
    onSettled: () => {
      submitting.current = false;
    }
  });
  function launch(event: FormEvent) {
    event.preventDefault();
    if (!operator || active || submitting.current) return;
    const error = rangeError(from, to);
    setValidation(error ?? "");
    if (error) return;
    const request = requestFor({ strategy: "ema", symbol: "BTCUSDT", interval, from, to }, attempt);
    useBacktestState.setState({ attempt: request });
    submitting.current = true;
    submit.mutate(request);
  }
  const points = useMemo(() => equity.data?.pages.flatMap((p) => p.items) ?? [], [equity.data]);
  const chart = useMemo(() => {
    try {
      return { ...curves(points, detail.data?.run.params?.initialEquity), error: "" };
    } catch {
      return { equity: [], drawdown: [], error: "Invalid equity history" };
    }
  }, [points, detail.data]);
  const trades = fills.data?.pages.flatMap((p) => p.items) ?? [],
    run = detail.data?.run;
  const retry = (error: unknown, action: () => void, label: string) => (
    <div className="backtest-notice" role="alert">
      <span>{error instanceof ApiError && error.status === 404 ? "Result not found" : label}</span>
      <button className="icon-button" title="Retry" aria-label={`Retry ${label}`} onClick={action}>
        <RefreshCw size={15} />
      </button>
    </div>
  );
  return (
    <main className="backtests-page">
      <header className="backtests-heading">
        <div>
          <h1>Backtests</h1>
          <span>Simulation / BTCUSDT</span>
        </div>
        <FlaskConical size={22} />
      </header>
      <div className="backtests-layout">
        <aside className="backtest-sidebar">
          <details className="simulation-disclosure">
            <summary>New simulation</summary>
            <form onSubmit={launch} className="backtest-launcher">
              <h2>New simulation</h2>
              <label>
                Strategy
                <select aria-label="Strategy" defaultValue="ema">
                  <option value="ema">EMA crossover (12 / 26)</option>
                </select>
              </label>
              <label>
                Market
                <select aria-label="Market" defaultValue="BTCUSDT">
                  <option value="BTCUSDT">BTCUSDT</option>
                </select>
              </label>
              <label>
                Interval
                <select
                  aria-label="Backtest interval"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as "15m" | "1h")}
                  disabled={submit.isPending || active}
                >
                  <option value="15m">15 minutes</option>
                  <option value="1h">1 hour</option>
                </select>
              </label>
              <label>
                From (UTC)
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  required
                  disabled={submit.isPending || active}
                />
              </label>
              <label>
                To (UTC, exclusive)
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  max={utcDay(Date.now())}
                  required
                  disabled={submit.isPending || active}
                />
              </label>
              <div className="simulation-settings">
                <span>Initial equity</span>
                <b>10,000 USDT</b>
                <span>Order quantity</span>
                <b>0.001 BTC</b>
                <span>Taker fee / slippage</span>
                <b>0.1% / 10 bps</b>
              </div>
              {!operator && (
                <p className="backtest-notice">Viewer / launch requires operator access</p>
              )}
              {validation && (
                <p className="backtest-notice negative" role="alert">
                  {validation}
                </p>
              )}
              {submit.isError && (
                <p className="backtest-notice negative" role="alert">
                  {submit.error instanceof ApiError && submit.error.status === 403
                    ? "Operator access required"
                    : "Submission failed. Retry keeps the same request ID."}
                </p>
              )}
              <button
                className="terminal-button terminal-button-primary"
                disabled={!operator || submit.isPending || active}
              >
                <Play size={14} />
                {submit.isPending
                  ? "Submitting"
                  : active
                    ? "Simulation active"
                    : submit.isError
                      ? "Retry submission"
                      : "Run simulation"}
              </button>
            </form>
          </details>
          {jobId && (
            <section className="backtest-job" aria-label="Simulation job">
              <h2>Job status</h2>
              <strong className={job.data?.job.state === "failed" ? "negative" : "positive"}>
                {job.data?.job.state ?? "Checking"}
              </strong>
              <small>{jobId}</small>
              {job.isError && retry(job.error, () => void job.refetch(), "Job status unavailable")}
              {job.data?.job.state === "failed" && (
                <p className="negative" role="alert">
                  {jobError(job.data.job.error)}
                </p>
              )}
            </section>
          )}
          <section className="backtest-saved">
            <div className="panel-title">
              <h2>Saved runs</h2>
              <button
                className="icon-button"
                title="Refresh saved runs"
                aria-label="Refresh saved runs"
                onClick={() => void runs.refetch()}
                disabled={runs.isFetching}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {runs.isPending && <p role="status">Loading runs</p>}
            {runs.isError && retry(runs.error, () => void runs.refetch(), "Saved runs unavailable")}
            {runs.data?.runs.length === 0 && <p>No saved runs</p>}
            <div className="saved-runs-list">
              {runs.data?.runs.map((r) => (
                <button
                  key={r.runId}
                  className={`saved-run-row ${runId === r.runId ? "active" : ""}`}
                  aria-pressed={runId === r.runId}
                  onClick={() => useBacktestState.setState({ selected: r.runId })}
                >
                  <strong>
                    {r.strategy.toUpperCase()} / {r.interval}
                  </strong>
                  <span>
                    {date(r.fromMs).slice(0, 10)} - {date(r.toMs).slice(0, 10)}
                  </span>
                  <small>{r.runId}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>
        <section className="backtest-results" aria-label="Backtest results">
          {!runId ? (
            <div className="terminal-empty">No saved results</div>
          ) : (
            <>
              {detail.isPending && <p role="status">Loading result</p>}
              {detail.isError &&
                retry(detail.error, () => void detail.refetch(), "Result unavailable")}
              {run && (
                <>
                  <header className="backtest-result-heading">
                    <h2>
                      {run.strategy.toUpperCase()} / {run.symbol} / {run.interval}
                    </h2>
                    <p>
                      {date(run.fromMs)} - {date(run.toMs)}
                    </p>
                    <small>{run.runId}</small>
                  </header>
                  <div className="backtest-metrics">
                    {[
                      ["Total return", "totalReturnPct", "%"],
                      ["Max drawdown", "maxDrawdownPct", "%"],
                      ["Sharpe", "sharpeRatio", ""],
                      ["Sortino", "sortinoRatio", ""],
                      ["Profit factor", "profitFactor", ""],
                      ["Win rate", "winRatePct", "%"],
                      ["Buy & hold", "buyAndHoldReturnPct", "%"],
                      ["Fills", "tradeCount", ""]
                    ].map(([label, key, suffix]) => (
                      <div key={key}>
                        <span>{label}</span>
                        <strong>
                          {key === "tradeCount"
                            ? typeof run.metrics[key!] === "number"
                              ? String(run.metrics[key!])
                              : "--"
                            : metric(run.metrics[key!], suffix)}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <a
                    className="report-link"
                    href={`/api/backtests/${encodeURIComponent(run.runId)}/report`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open HTML report
                  </a>
                  <div className="backtest-curves">
                    <section>
                      <div className="panel-title">
                        <h2>Equity / USDT</h2>
                        <small>
                          {points.length} points{equity.isFetching ? " / loading" : ""}
                        </small>
                      </div>
                      <ResultChart points={chart.equity} tone="equity" />
                    </section>
                    <section>
                      <div className="panel-title">
                        <h2>Drawdown / %</h2>
                        <small>
                          {typeof run.params?.initialEquity === "string"
                            ? "Initial equity baseline"
                            : "Observed baseline"}
                        </small>
                      </div>
                      <ResultChart points={chart.drawdown} tone="drawdown" />
                    </section>
                  </div>
                  {equity.isError &&
                    retry(equity.error, () => void equity.refetch(), "Equity history unavailable")}
                  {chart.error && (
                    <p className="negative" role="alert">
                      {chart.error}
                    </p>
                  )}
                  {equity.data?.pages.at(-1)?.nextCursor !== null &&
                    equity.data?.pages.length === 10 && (
                      <p className="backtest-notice">Equity view limited to 10,000 points</p>
                    )}
                  {!equity.isPending && !equity.isError && points.length === 0 && (
                    <p className="backtest-notice">No saved equity points</p>
                  )}
                  <section className="backtest-trades">
                    <div className="panel-title">
                      <h2>Simulated fills</h2>
                      <small>{trades.length} loaded</small>
                    </div>
                    {fills.isError &&
                      retry(fills.error, () => void fills.refetch(), "Fill history unavailable")}
                    <DataTable
                      columns={["Time", "Side", "Quantity", "Price / USDT", "Fee"]}
                      rows={trades.map((t) => [
                        date(t.tsMs),
                        t.side,
                        t.quantity,
                        formatUsd(t.price),
                        `${t.fee} ${t.feeAsset}`
                      ])}
                      emptyLabel={fills.isPending ? "Loading fills" : "No simulated fills"}
                    />
                    {fills.hasNextPage && (
                      <button
                        className="terminal-button terminal-button-ghost"
                        disabled={fills.isFetchingNextPage}
                        onClick={() => void fills.fetchNextPage()}
                      >
                        <ChevronDown size={15} />
                        {fills.isFetchingNextPage ? "Loading" : "Load more fills"}
                      </button>
                    )}
                    {fills.data?.pages.length === 25 &&
                      fills.data.pages.at(-1)?.nextCursor !== null && (
                        <p className="backtest-notice">Fill view limited to 5,000 rows</p>
                      )}
                  </section>
                  {run.params && (
                    <dl className="backtest-parameters">
                      {[
                        "initialEquity",
                        "quantity",
                        "fastPeriod",
                        "slowPeriod",
                        "takerFeeRate",
                        "slippageBps"
                      ].map((key) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {typeof run.params?.[key] === "string" ||
                            typeof run.params?.[key] === "number"
                              ? String(run.params[key])
                              : "--"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
