import { afterEach, expect, it, vi } from "vitest";
import { createRedisCommandDeadline } from "./redis-command-deadline.js";

afterEach(() => {
  vi.useRealTimers();
});

it("disconnects a blackholed read on deadline so safety work cannot wait indefinitely", async () => {
  vi.useFakeTimers();
  let resolve!: (value: unknown) => void;
  const disconnect = vi.fn();
  const command = createRedisCommandDeadline({
    timeoutMs: 5000,
    disconnect,
    sendCommand: () =>
      new Promise((done) => {
        resolve = done;
      })
  });
  const result = expect(command(["XREADGROUP"])).rejects.toThrow(
    "Executor Redis command timed out"
  );
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  expect(disconnect).toHaveBeenCalledOnce();
  resolve("late reply");
  await vi.runAllTimersAsync();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("clears deadlines on success and ordinary rejection without disconnecting", async () => {
  vi.useFakeTimers();
  const disconnect = vi.fn();
  const sendCommand = vi
    .fn()
    .mockResolvedValueOnce("PONG")
    .mockRejectedValueOnce(new Error("offline"));
  const command = createRedisCommandDeadline({ timeoutMs: 5000, disconnect, sendCommand });
  await expect(command(["PING"])).resolves.toBe("PONG");
  await expect(command(["GET", "flag"])).rejects.toThrow("offline");
  expect(vi.getTimerCount()).toBe(0);
  expect(disconnect).not.toHaveBeenCalled();
});

it("still rejects when disconnect throws", async () => {
  vi.useFakeTimers();
  const command = createRedisCommandDeadline({
    timeoutMs: 10,
    sendCommand: () => new Promise(() => {}),
    disconnect: () => {
      throw new Error("closed");
    }
  });
  const result = expect(command(["PING"])).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(10);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});

it("socket destruction rejects queued safety commands and clears their deadlines", async () => {
  vi.useFakeTimers();
  const pending: ((error: Error) => void)[] = [];
  const disconnect = vi.fn(() => {
    for (const reject of pending) reject(new Error("socket closed"));
  });
  const command = createRedisCommandDeadline({
    timeoutMs: 5000,
    disconnect,
    sendCommand: () =>
      new Promise((_resolve, reject) => {
        pending.push(reject);
      })
  });
  const read = expect(command(["XREADGROUP"])).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(100);
  const ping = expect(command(["PING"])).rejects.toThrow("socket closed");
  await vi.advanceTimersByTimeAsync(4900);
  await read;
  await ping;
  expect(disconnect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, -1, NaN, 1.5, 2147483648])("rejects invalid deadline %s", (timeoutMs) => {
  expect(() =>
    createRedisCommandDeadline({ timeoutMs, disconnect: vi.fn(), sendCommand: vi.fn() })
  ).toThrow("Invalid Redis command deadline");
});
