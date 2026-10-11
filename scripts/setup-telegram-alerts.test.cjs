const { test } = require("node:test");
const assert = require("node:assert/strict");
const { selectChat, configuration, telegram } = require("./setup-telegram-alerts.cjs");

test("only selects one private start destination; explicit safe IDs supported", () => {
  const start = (id) => ({ message: { chat: { id, type: "private" }, text: "/start" } });
  assert.equal(selectChat([start(123), start(123)]), 123);
  assert.equal(selectChat([], "-123"), -123);
  assert.throws(() => selectChat([]));
  assert.throws(() => selectChat([start(123), start(124)]));
  assert.throws(() => selectChat([], "123\nreceiver: leak"));
  assert.throws(() => selectChat([], "9007199254740992"));
});
test("routes suppress only intentionally inactive trading targets by default", () => {
  const config = configuration("fake:token", 123);
  assert.equal(config.receivers[1].telegram_configs[0].send_resolved, true);
  assert.equal(config.route.repeat_interval, "4h");
  assert.deepEqual(config.route.routes[0].matchers, ['job=~"meridian-engine|meridian-executor"']);
  assert.deepEqual(configuration("fake:token", 123, true).route.routes, []);
});
test("transport errors and rejected responses never expose token/body", async () => {
  await assert.rejects(
    telegram("secret", "getMe", {}, async () => {
      throw new Error("secret");
    }),
    (error) => !error.message.includes("secret")
  );
  await assert.rejects(
    telegram("secret", "getMe", {}, async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, description: "secret" })
    })),
    /HTTP 401/
  );
});
