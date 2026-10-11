import { Decimal } from "decimal.js";
import type { EquityPoint, Job, JobRequest } from "./backtest-api.js";

export function rangeError(from: string, to: string, now = Date.now()): string | null {
  const parse = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const time = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? time : NaN;
  };
  const start = parse(from),
    end = parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Select valid UTC dates";
  if (start >= end) return "End date must follow start date";
  if (end > now) return "End date must be in the past";
  if (end - start > 30 * 86400000) return "Maximum range is 30 days";
  return null;
}
export function requestFor(
  form: Omit<JobRequest, "requestId">,
  previous: JobRequest | null,
  uuid: () => string = () => crypto.randomUUID()
): JobRequest {
  if (
    previous &&
    (["strategy", "symbol", "interval", "from", "to"] as const).every(
      (key) => previous[key] === form[key]
    )
  )
    return previous;
  return { ...form, requestId: uuid() };
}
export function shouldPoll(job: Job | undefined, error: unknown): number | false {
  return !error && job && (job.state === "queued" || job.state === "running") ? 2000 : false;
}
export function curves(points: EquityPoint[], initial: unknown) {
  const equity: { time: number; value: number }[] = [],
    drawdown: { time: number; value: number }[] = [];
  let peak =
    typeof initial === "string" && initial.length <= 128 && /^\d+(?:\.\d+)?$/.test(initial)
      ? new Decimal(initial)
      : null;
  if (peak && (!peak.isFinite() || peak.lte(0) || peak.gt("1e30"))) peak = null;
  let last = -1;
  for (const p of points) {
    if (
      typeof p.equity !== "string" ||
      typeof p.tsMs !== "string" ||
      !/^\d+$/.test(p.tsMs) ||
      !Number.isSafeInteger(Number(p.tsMs)) ||
      p.equity.length > 128 ||
      !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(p.equity)
    )
      throw new Error("Invalid equity data");
    const value = new Decimal(p.equity),
      time = Math.floor(Number(p.tsMs) / 1000);
    if (
      !value.isFinite() ||
      value.lt(0) ||
      value.gt("1e30") ||
      !Number.isSafeInteger(time) ||
      time <= last
    )
      throw new Error("Invalid equity data");
    peak = peak ? Decimal.max(peak, value) : value;
    equity.push({ time, value: value.toNumber() });
    drawdown.push({
      time,
      value: peak.isZero() ? 0 : value.minus(peak).div(peak).times(100).toNumber()
    });
    last = time;
  }
  return { equity, drawdown };
}
