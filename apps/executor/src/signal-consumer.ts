import {
  autoClaimStaleMessages,
  ensureConsumerGroup,
  readConsumerGroup,
  streams,
  type RedisStreamClient,
  type StreamMessage
} from "@meridian/bus";

import {
  processSignalMessage,
  type SignalMessageDeps,
  type SignalProcessingResult
} from "./signal-execution.js";

export interface SignalConsumerLogger {
  readonly info: (data: Record<string, unknown>, message: string) => void;
  readonly warn: (data: Record<string, unknown>, message: string) => void;
  readonly error: (data: Record<string, unknown>, message: string) => void;
}

export interface SignalConsumerOptions extends Omit<SignalMessageDeps, "group" | "bus"> {
  readonly bus: RedisStreamClient;
  readonly group: string;
  readonly consumer: string;
  readonly logger: SignalConsumerLogger;
  readonly readCount?: number;
  readonly blockMs?: number;
  readonly staleMinIdleMs?: number;
}

export interface SignalConsumer {
  readonly ensureReady: () => Promise<void>;
  readonly pollOnce: () => Promise<readonly SignalProcessingResult[]>;
  readonly claimStaleOnce: () => Promise<readonly SignalProcessingResult[]>;
}

export function createSignalConsumer(options: SignalConsumerOptions): SignalConsumer {
  const readCount = options.readCount ?? 10;
  const blockMs = options.blockMs ?? 1_000;
  const staleMinIdleMs = options.staleMinIdleMs ?? 30_000;

  async function handleMessage(
    message: StreamMessage
  ): Promise<SignalProcessingResult | undefined> {
    try {
      const result = await processSignalMessage(message, {
        bus: options.bus,
        group: options.group,
        store: options.store,
        exchange: options.exchange,
        clientOrderIdPrefix: options.clientOrderIdPrefix,
        nowMs: options.nowMs,
        ...(options.riskGate === undefined ? {} : { riskGate: options.riskGate }),
        ...(options.beforeSubmit === undefined ? {} : { beforeSubmit: options.beforeSubmit }),
        ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
        ...(options.recordRejection === undefined
          ? {}
          : { recordRejection: options.recordRejection })
      });

      logResult(result, options.logger);
      return result;
    } catch (error) {
      options.logger.error(
        {
          error,
          stream: streams.signals,
          messageId: message.id
        },
        "signal processing failed; message left pending for retry"
      );
      return undefined;
    }
  }

  return {
    async ensureReady() {
      await ensureConsumerGroup(options.bus, streams.signals, options.group, "0");
    },

    async pollOnce() {
      const results = await readConsumerGroup(
        options.bus,
        options.group,
        options.consumer,
        streams.signals,
        {
          count: readCount,
          blockMs
        }
      );

      if (results === null) return [];

      return processMessages(
        results.flatMap((result) => result.messages),
        handleMessage
      );
    },

    async claimStaleOnce() {
      const claimed = await autoClaimStaleMessages(
        options.bus,
        streams.signals,
        options.group,
        options.consumer,
        staleMinIdleMs,
        "0-0",
        {
          count: readCount
        }
      );

      return processMessages(claimed.messages, handleMessage);
    }
  };
}

async function processMessages(
  messages: readonly StreamMessage[],
  handleMessage: (message: StreamMessage) => Promise<SignalProcessingResult | undefined>
): Promise<readonly SignalProcessingResult[]> {
  const outcomes: SignalProcessingResult[] = [];

  for (const message of messages) {
    const result = await handleMessage(message);
    if (result !== undefined) {
      outcomes.push(result);
    }
  }

  return outcomes;
}

function logResult(result: SignalProcessingResult, logger: SignalConsumerLogger): void {
  switch (result.outcome) {
    case "submitted":
      logger.info(
        {
          signalId: result.signalId,
          clientOrderId: result.clientOrderId
        },
        "signal submitted"
      );
      return;

    case "expired":
      logger.warn(
        {
          signalId: result.signalId
        },
        "expired signal dropped"
      );
      return;

    case "rejected":
      logger.warn(
        {
          signalId: result.signalId,
          reason: result.reason
        },
        "signal rejected"
      );
      return;
  }
}
