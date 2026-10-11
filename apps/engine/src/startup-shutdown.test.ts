import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), close: vi.fn(), clientsClose: vi.fn() }));
vi.mock("@meridian/config", () => ({
  loadConfig: () => ({ DATABASE_URL: "fixture", REDIS_URL: "fixture" })
}));
vi.mock("@meridian/binance-client", async (original) => ({
  ...(await original<object>()),
  createTestnetTradingClientFromEnv: mocks.create
}));
vi.mock("./runtime-clients.js", () => ({
  createEngineRuntimeClients: () => ({ close: mocks.clientsClose })
}));
import { runCliMain } from "./main.js";

it("latches SIGTERM during asynchronous startup and never starts the engine loop", async () => {
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
  const result = expect(run).rejects.toThrow("Engine startup cancelled");
  process.emit("SIGTERM");
  resolve({ close: mocks.close });
  await result;
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.clientsClose).toHaveBeenCalledOnce();
});
