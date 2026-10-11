/* global __dirname */
const { fetch, AbortSignal } = globalThis;
const fs = require("node:fs/promises");
const path = require("node:path");

function selectChat(updates, configured) {
  if (configured) {
    if (!/^-?[1-9]\d*$/.test(configured) || !Number.isSafeInteger(Number(configured)))
      throw new Error("TELEGRAM_CHAT_ID must be a nonzero safe integer");
    return Number(configured);
  }
  const chats = new Set(
    updates
      .filter(
        (u) => u.message?.chat?.type === "private" && /^\/start(?:\s|$)/.test(u.message.text || "")
      )
      .map((u) => u.message.chat.id)
  );
  if (chats.size !== 1)
    throw new Error(
      "Send /start to the bot; if multiple chats exist, set TELEGRAM_CHAT_ID explicitly"
    );
  return selectChat([], String([...chats][0]));
}

function configuration(token, chatId, tradingAlerts = false) {
  return {
    global: { resolve_timeout: "5m" },
    route: {
      receiver: "telegram",
      group_by: ["alertname", "job"],
      group_wait: "10s",
      group_interval: "1m",
      repeat_interval: "4h",
      routes: tradingAlerts
        ? []
        : [
            {
              receiver: "local-only",
              matchers: ['job=~"meridian-engine|meridian-executor"']
            },
            {
              receiver: "local-only",
              matchers: ['job="meridian-health"', 'service=~"engine|executor"']
            }
          ]
    },
    receivers: [
      { name: "local-only" },
      {
        name: "telegram",
        telegram_configs: [
          {
            bot_token: token,
            chat_id: chatId,
            send_resolved: true,
            parse_mode: "",
            message:
              "{{ .Status | toUpper }} / Meridian\n{{ range .Alerts }}{{ .Labels.alertname }} / {{ .Labels.severity }}\n{{ .Annotations.summary }}\n{{ end }}"
          }
        ]
      }
    ]
  };
}

async function telegram(token, method, body, request = fetch) {
  let response, data;
  try {
    response = await request(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });
    data = await response.json();
  } catch {
    throw new Error("Telegram request failed (details withheld to protect token)");
  }
  if (!response.ok || data.ok !== true)
    throw new Error(`Telegram rejected ${method} (HTTP ${response.status})`);
  return data.result;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN || process.env.MERIDO_BOT_TOKEN;
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token))
    throw new Error("Set TELEGRAM_BOT_TOKEN in .env (MERIDO_BOT_TOKEN alias supported)");
  await telegram(token, "getMe", {});
  const directory = path.resolve(__dirname, "../infra/alertmanager/.local");
  let configuredChat = process.env.TELEGRAM_CHAT_ID;
  if (!configuredChat) {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(directory, "alertmanager.yml"), "utf8"));
      const receiver = saved.receivers.find((r) => r.name === "telegram").telegram_configs[0];
      if (receiver.bot_token === token) configuredChat = String(receiver.chat_id);
    } catch {
      /* Missing/invalid local configuration requires fresh explicit discovery. */
    }
  }
  const updates = configuredChat
    ? []
    : await telegram(token, "getUpdates", { timeout: 0, limit: 100 });
  const chatId = selectChat(updates, configuredChat);
  await fs.mkdir(directory, { recursive: true });
  // JSON is valid YAML; values cannot inject routes or template syntax.
  await fs.writeFile(
    path.join(directory, "alertmanager.yml"),
    JSON.stringify(
      configuration(token, chatId, process.env.TELEGRAM_TRADING_ALERTS === "true"),
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(
    JSON.stringify({
      configured: true,
      privateConfig: "infra/alertmanager/.local/alertmanager.yml",
      tradingAlerts: process.env.TELEGRAM_TRADING_ALERTS === "true"
    })
  );
}

module.exports = { selectChat, configuration, telegram };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
