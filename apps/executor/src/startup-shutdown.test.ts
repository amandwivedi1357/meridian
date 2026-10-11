import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  clientsClose: vi.fn(),
  command: vi.fn(),
  execute: vi.fn()
}));
vi.mock("@meridian/config", () => ({
  loadConfig: () => ({ DATABASE_URL: "fixture", REDIS_URL: "fixture" })
}));
vi.mock("@meridian/binance-client", async (original) => ({
  ...(await original<object>()),
  createTestnetTradingClientFromEnv: mocks.create
}));
vi.mock("./runtime-clients.js", () => ({
  createExecutorRuntimeClients: () => ({
    close: mocks.clientsClose,
    redis: { command: mocks.command },
    postgres: { execute: mocks.execute }
  })
}));
import { runCliMain } from "./main.js";

it("latches SIGTERM during startup without reconciliation or order submission", async () => {
  let resolve!: (client: { close: typeof mocks.close }) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  mocks.close.mockResolvedValue(undefined);
  mocks.clientsClose.mockResolvedValue(undefined);
  const run = runCliMain();
  const result = expect(run).rejects.toThrow("Executor startup cancelled");
  process.emit("SIGTERM");
  resolve({ close: mocks.close });
  await result;
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.clientsClose).toHaveBeenCalledOnce();
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.execute).not.toHaveBeenCalled();
});
