export const streams = {
  control: "control",
  orderCommands: "orders.commands",
  orderEvents: "orders.events",
  signals: "signals"
} as const;

export function marketTradeStream(symbol: string) {
  return `market.trade.${symbol}`;
}

export function marketKlineStream(symbol: string, interval: string) {
  return `market.kline.${symbol}.${interval}`;
}

export function marketBookStream(symbol: string) {
  return `market.book.${symbol}`;
}

export type StreamId = string;

export type StreamFieldValue = string | Buffer;

export type StreamFields = Readonly<Record<string, StreamFieldValue>>;

export interface StreamMessage {
  readonly id: StreamId;
  readonly fields: StreamFields;
}

export interface ClaimedStreamMessages {
  readonly nextStartId: StreamId;
  readonly messages: readonly StreamMessage[];
}

export interface RedisStreamClient {
  readonly xAdd: (stream: string, id: "*", fields: StreamFields) => Promise<StreamId>;

  readonly xGroupCreate: (
    stream: string,
    group: string,
    id: StreamId,
    options?: {
      readonly mkStream?: boolean;
    }
  ) => Promise<unknown>;

  readonly xReadGroup: (
    group: string,
    consumer: string,
    streams: readonly {
      readonly key: string;
      readonly id: StreamId;
    }[],
    options?: {
      readonly count?: number;
      readonly blockMs?: number;
    }
  ) => Promise<readonly StreamReadResult[] | null>;

  readonly xAck: (stream: string, group: string, id: StreamId) => Promise<number>;

  readonly xAutoClaim: (
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    startId: StreamId,
    options?: {
      readonly count?: number;
    }
  ) => Promise<ClaimedStreamMessages>;
}

export interface StreamReadResult {
  readonly stream: string;
  readonly messages: readonly StreamMessage[];
}

export interface RedisCommandClient {
  readonly sendCommand: (args: readonly (string | Buffer)[]) => Promise<unknown>;
}

export function createRedisStreamClient(client: RedisCommandClient): RedisStreamClient {
  return {
    async xAdd(stream, id, fields) {
      const reply = await client.sendCommand(buildXaddCommand(stream, id, fields));

      if (typeof reply !== "string") {
        throw new Error("Redis XADD did not return a stream entry id");
      }

      return reply;
    },

    xGroupCreate(stream, group, id, options = {}) {
      const command: (string | Buffer)[] = ["XGROUP", "CREATE", stream, group, id];

      if (options.mkStream) {
        command.push("MKSTREAM");
      }

      return client.sendCommand(command);
    },

    async xReadGroup(group, consumer, streamsToRead, options = {}) {
      const command: (string | Buffer)[] = ["XREADGROUP", "GROUP", group, consumer];

      if (options.count !== undefined) {
        command.push("COUNT", String(options.count));
      }

      if (options.blockMs !== undefined) {
        command.push("BLOCK", String(options.blockMs));
      }

      command.push(
        "STREAMS",
        ...streamsToRead.map((stream) => stream.key),
        ...streamsToRead.map((stream) => stream.id)
      );

      const reply = await client.sendCommand(command);

      if (reply === null) {
        return null;
      }

      return parseXreadReply(reply);
    },

    async xAck(stream, group, id) {
      const reply = await client.sendCommand(["XACK", stream, group, id]);

      if (typeof reply !== "number") {
        throw new Error("Redis XACK did not return an acknowledgement count");
      }

      return reply;
    },

    async xAutoClaim(stream, group, consumer, minIdleMs, startId, options = {}) {
      const command: (string | Buffer)[] = [
        "XAUTOCLAIM",
        stream,
        group,
        consumer,
        String(minIdleMs),
        startId
      ];

      if (options.count !== undefined) {
        command.push("COUNT", String(options.count));
      }

      const reply = await client.sendCommand(command);

      return parseXautoClaimReply(reply);
    }
  };
}

export function publishStreamMessage(
  client: RedisStreamClient,
  stream: string,
  fields: StreamFields
): Promise<StreamId> {
  return client.xAdd(stream, "*", fields);
}

export async function ensureConsumerGroup(
  client: RedisStreamClient,
  stream: string,
  group: string,
  startId: StreamId = "0"
): Promise<void> {
  try {
    await client.xGroupCreate(stream, group, startId, { mkStream: true });
  } catch (error) {
    if (isBusyGroupError(error)) {
      return;
    }

    throw error;
  }
}

export function readConsumerGroup(
  client: RedisStreamClient,
  group: string,
  consumer: string,
  stream: string,
  options: {
    readonly count?: number;
    readonly blockMs?: number;
  } = {}
): Promise<readonly StreamReadResult[] | null> {
  return client.xReadGroup(
    group,
    consumer,
    [
      {
        key: stream,
        id: ">"
      }
    ],
    options
  );
}

export function ackStreamMessage(
  client: RedisStreamClient,
  stream: string,
  group: string,
  id: StreamId
): Promise<number> {
  return client.xAck(stream, group, id);
}

export function autoClaimStaleMessages(
  client: RedisStreamClient,
  stream: string,
  group: string,
  consumer: string,
  minIdleMs: number,
  startId: StreamId = "0-0",
  options: {
    readonly count?: number;
  } = {}
): Promise<ClaimedStreamMessages> {
  return client.xAutoClaim(stream, group, consumer, minIdleMs, startId, options);
}

function isBusyGroupError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("BUSYGROUP");
}

function buildXaddCommand(
  stream: string,
  id: "*",
  fields: StreamFields
): readonly (string | Buffer)[] {
  const command: (string | Buffer)[] = ["XADD", stream, id];

  for (const [field, value] of Object.entries(fields)) {
    command.push(field, value);
  }

  return command;
}

function parseXreadReply(reply: unknown): readonly StreamReadResult[] {
  if (isObjectXreadReply(reply)) {
    return Object.entries(reply).map(([stream, messages]) => ({
      stream,
      messages: messages.map(parseStreamMessage)
    }));
  }

  if (Array.isArray(reply)) {
    return reply.map(parseStreamReadResult);
  }

  throw new Error("Redis XREADGROUP returned an unexpected reply");
}

function parseStreamReadResult(reply: unknown): StreamReadResult {
  if (!Array.isArray(reply) || reply.length !== 2 || typeof reply[0] !== "string") {
    throw new Error("Redis stream read result has an unexpected shape");
  }

  const messagesReply = reply[1];

  if (!Array.isArray(messagesReply)) {
    throw new Error("Redis stream messages have an unexpected shape");
  }

  return {
    stream: reply[0],
    messages: messagesReply.map(parseStreamMessage)
  };
}

function parseStreamMessage(reply: unknown): StreamMessage {
  if (!Array.isArray(reply) || reply.length !== 2 || typeof reply[0] !== "string") {
    throw new Error("Redis stream message has an unexpected shape");
  }

  return {
    id: reply[0],
    fields: parseFieldList(reply[1])
  };
}

function parseFieldList(reply: unknown): StreamFields {
  if (!Array.isArray(reply)) {
    throw new Error("Redis stream message fields have an unexpected shape");
  }

  if (reply.length % 2 !== 0) {
    throw new Error("Redis stream message fields must be key-value pairs");
  }

  const fields: Record<string, StreamFieldValue> = {};

  for (let index = 0; index < reply.length; index += 2) {
    const field = reply[index];
    const value = reply[index + 1];

    if (typeof field !== "string") {
      throw new Error("Redis stream field names must be strings");
    }

    if (typeof value !== "string" && !Buffer.isBuffer(value)) {
      throw new Error("Redis stream field values must be strings or buffers");
    }

    fields[field] = value;
  }

  return fields;
}

function parseXautoClaimReply(reply: unknown): ClaimedStreamMessages {
  if (!Array.isArray(reply) || reply.length < 2 || typeof reply[0] !== "string") {
    throw new Error("Redis XAUTOCLAIM returned an unexpected reply");
  }

  const messagesReply = reply[1];

  if (!Array.isArray(messagesReply)) {
    throw new Error("Redis XAUTOCLAIM messages have an unexpected shape");
  }

  return {
    nextStartId: reply[0],
    messages: messagesReply.map(parseStreamMessage)
  };
}

function isObjectXreadReply(reply: unknown): reply is Record<string, readonly unknown[]> {
  return typeof reply === "object" && reply !== null && !Array.isArray(reply);
}
