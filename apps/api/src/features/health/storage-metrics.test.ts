import { Registry } from "@meridian/observability";
import { expect, it, vi } from "vitest";
import { instrumentStorageHealth } from "./storage-metrics.js";
import type { SystemHealth } from "./system-health.js";

it("exports real samples and removes stale/unknown group series rather than inventing zero lag", async () => {
  const registry = new Registry();
  const sample: SystemHealth = {
    checkedAt: 15000,
    redis: "available",
    database: "available",
    streams: [
      {
        stream: "signals",
        status: "available",
        length: 10,
        groups: [
          { name: "executor", consumers: 1, pending: 2, lag: 3 },
          { name: "arbitrary-user-group", consumers: 1, pending: 10, lag: 10 }
        ]
      }
    ]
  };
  const source = vi.fn(async () => sample);
  const read = instrumentStorageHealth(source, registry);
  expect(await read()).toBe(sample);
  let output = await registry.metrics();
  expect(output).toContain('bus_consumer_lag{stream="signals",group="executor"} 3');
  expect(output).toContain('bus_pending_entries{stream="signals",group="executor"} 2');
  expect(output).not.toContain("arbitrary-user-group");
  expect(output).toContain("meridian_storage_sample_timestamp_seconds 15");
  sample.streams[0]!.groups[0]!.lag = null;
  await read();
  output = await registry.metrics();
  expect(output).not.toContain("bus_consumer_lag{");
  sample.redis = "unavailable";
  sample.streams[0]!.status = "unavailable";
  await read();
  output = await registry.metrics();
  expect(output).toContain('meridian_dependency_available{dependency="redis"} 0');
  expect(output).not.toContain("meridian_stream_length{");
  expect(output).not.toContain("bus_pending_entries{");
  source.mockRejectedValueOnce(new Error("private database detail"));
  await expect(read()).rejects.toThrow();
  expect(await registry.metrics()).not.toContain("private database detail");
});
