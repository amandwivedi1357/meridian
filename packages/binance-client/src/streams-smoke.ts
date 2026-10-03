import { createStreamConnectionManager } from "./streams/connection-manager.js";
import { tradeStream } from "./streams/subscriptions.js";

let messageCount = 0;

const manager = createStreamConnectionManager({
  environment: "production",
subscriptions: [tradeStream("BTCUSDT")]
});

manager.onStateChange((event) => {
  console.log("state", event);
});

manager.onMessage((message) => {
  messageCount += 1;
  console.log("message", {
    stream: message.stream,
    eventType:
      typeof message.data === "object" && message.data !== null && "e" in message.data
        ? message.data.e
        : undefined
  });

  if (messageCount >= 3) {
    manager.close();
  }
});

manager.connect();

setTimeout(() => {
  manager.close();
}, 10_000);

setTimeout(() => {
  process.exit(0);
}, 12_000);
