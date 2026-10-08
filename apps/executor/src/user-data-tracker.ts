import type { UserDataEvent, UserDataStreamState } from "@meridian/binance-client";
import { handleUserDataOrderUpdate, type OrderUpdateStore } from "./order-update-handler.js";

export interface ExecutorUserDataStream {
  start(): void;
  close(): void;
  getState(): UserDataStreamState;
  onEvent(handler: (event: UserDataEvent) => void): () => void;
  onStateChange(handler: (state: UserDataStreamState) => void): () => void;
}

export function createExecutorUserDataTracker(options: {
  stream: ExecutorUserDataStream;
  store: OrderUpdateStore;
  reconcile: () => Promise<unknown>;
  onError: (error: unknown) => void;
  timeoutMs?: number;
}) {
  let ready = false;
  let closed = false;
  let started = false;
  let generation = 0;
  let failure: unknown;
  let pending = Promise.resolve();
  let unsubscribeEvent = () => {};
  let unsubscribeState = () => {};
  let resolveStart: (() => void) | undefined;
  let rejectStart: ((error: unknown) => void) | undefined;
  let deadline: NodeJS.Timeout | undefined;

  function enqueue(work: () => Promise<void>) {
    if (closed) return;
    pending = pending
      .then(async () => {
        if (failure === undefined) await work();
      })
      .catch((error: unknown) => {
        failure = error;
        ready = false;
        clearTimeout(deadline);
        rejectStart?.(error);
        try {
          options.onError(error);
        } catch {
          /* Execution remains blocked even if logging fails. */
        }
      });
  }

  return {
    async start(): Promise<void> {
      if (started || closed) throw new Error("User-data tracker already started or closed");
      started = true;
      const opened = new Promise<void>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
        deadline = setTimeout(
          () => reject(new Error("User-data tracker startup timed out")),
          options.timeoutMs ?? 30_000
        );
      });
      unsubscribeEvent = options.stream.onEvent((event) => {
        if (event.kind === "order-update")
          enqueue(() => handleUserDataOrderUpdate(event, { store: options.store }));
      });
      unsubscribeState = options.stream.onStateChange((state) => {
        ready = false;
        const current = ++generation;
        if (state === "FAILED" || state === "CLOSED") {
          clearTimeout(deadline);
          rejectStart?.(new Error("User-data stream stopped"));
        }
        if (state === "OPEN")
          enqueue(async () => {
            await options.reconcile();
            if (!closed && generation === current && options.stream.getState() === "OPEN") {
              ready = true;
              clearTimeout(deadline);
              resolveStart?.();
            }
          });
      });
      try {
        options.stream.start();
        await opened;
      } catch (error) {
        ready = false;
        clearTimeout(deadline);
        unsubscribeEvent();
        unsubscribeState();
        options.stream.close();
        throw error;
      }
    },
    async assertReady(): Promise<void> {
      let work: Promise<void>;
      do {
        work = pending;
        await work;
      } while (work !== pending);
      if (closed || failure !== undefined || !ready || options.stream.getState() !== "OPEN") {
        throw new Error("User-data tracking is unavailable; execution blocked");
      }
    },
    async close(): Promise<void> {
      closed = true;
      ready = false;
      clearTimeout(deadline);
      rejectStart?.(new Error("User-data tracker closed"));
      unsubscribeEvent();
      unsubscribeState();
      options.stream.close();
      await pending;
    }
  };
}
