import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, "Invalid UTC calendar date");
export const jobRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    strategy: z.literal("ema").default("ema"),
    symbol: z.literal("BTCUSDT").default("BTCUSDT"),
    interval: z.enum(["15m", "1h"]).default("15m"),
    from: date,
    to: date
  })
  .strict()
  .refine((value) => {
    const from = Date.parse(value.from),
      to = Date.parse(value.to);
    return from < to && to - from <= 30 * 86400000 && to <= Date.now();
  }, "Require a past increasing UTC range of at most 30 days");
export type JobRequest = z.infer<typeof jobRequestSchema>;
export const jobSchema = z.object({
  jobId: z.string().uuid(),
  state: z.enum(["queued", "running", "succeeded", "failed"]),
  request: jobRequestSchema,
  runId: z.string().nullable(),
  summary: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable()
});
export type BacktestJob = z.infer<typeof jobSchema>;
export function jobDto(row: Record<string, unknown>): BacktestJob {
  return jobSchema.parse({
    jobId: row.job_id,
    state: row.state,
    request: row.request,
    runId: row.run_id,
    summary: row.summary,
    error: row.error,
    createdAt: (row.created_at as Date).toISOString(),
    startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
    finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null
  });
}
