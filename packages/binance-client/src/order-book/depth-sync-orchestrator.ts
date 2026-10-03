import type { BookSnapshot } from "@meridian/core";
import type { BinanceDepthStreamPayload } from "../streams/payloads.js";
import {
  createLocalDepthSync,
  type DepthSyncResult,
  type DepthSyncState,
  type LocalDepthSync
} from "./depth-sync.js";

export type DepthSyncOrchestratorStatus =
  | "LOADING_SNAPSHOT"
  | "SYNCED"
  | "NEEDS_RESYNC";

export interface LoadDepthSnapshotResult {
  readonly book: BookSnapshot;
  readonly lastUpdateId: number;
}

export interface DepthSyncOrchestratorOptions {
  readonly symbol: string;
  readonly loadSnapshot: () => Promise<LoadDepthSnapshotResult>;
  readonly now?: () => number;
}

export interface DepthSyncOrchestrator {
  start(): Promise<void>;
  handleDepthEvent(event: BinanceDepthStreamPayload): Promise<DepthSyncResult | undefined>;
  getState(): DepthSyncState | undefined;
  getStatus(): DepthSyncOrchestratorStatus;
  getResyncCount(): number;
  getUpdateLagMs(): number | undefined;
  snapshot(): BookSnapshot | undefined;
}

export function createDepthSyncOrchestrator(
  options: DepthSyncOrchestratorOptions
): DepthSyncOrchestrator {
  let bufferedEvents: BinanceDepthStreamPayload[] = [];
  const now = options.now ?? Date.now;
  let resyncCount = 0;
  let sync: LocalDepthSync | undefined;
  let status: DepthSyncOrchestratorStatus = "LOADING_SNAPSHOT";
  let startPromise: Promise<void> | undefined;

  async function start(): Promise<void> {
    startPromise ??= reloadSnapshot();
    await startPromise;
  }

  async function handleDepthEvent(
    event: BinanceDepthStreamPayload
  ): Promise<DepthSyncResult | undefined> {
    if (event.s !== options.symbol) {
      return undefined;
    }

    if (sync === undefined) {
      bufferedEvents.push(event);
      return undefined;
    }

    const result = sync.applyDepthEvent(event);

    if (result.state.status === "NEEDS_RESYNC") {
      bufferedEvents = [];
      resyncCount += 1;
      startPromise = reloadSnapshot();
      await startPromise;
      return result;
    }

    status = "SYNCED";
    return result;
  }

  async function reloadSnapshot(): Promise<void> {
    status = "LOADING_SNAPSHOT";
    const snapshot = await options.loadSnapshot();
    sync = createLocalDepthSync(snapshot);

    const eventsToReplay = bufferedEvents;
    bufferedEvents = [];

    for (const event of eventsToReplay) {
      const result = sync.applyDepthEvent(event);

      if (result.state.status === "NEEDS_RESYNC") {
        status = "NEEDS_RESYNC";
        return;
      }
    }

    status = sync.getState().status === "SYNCED" ? "SYNCED" : "LOADING_SNAPSHOT";
  }

  return {
    start,
    handleDepthEvent,
    getState: () => sync?.getState(),
    getStatus: () => status,
    getResyncCount: () => resyncCount,
    getUpdateLagMs: () => {
      const currentSnapshot = sync?.snapshot();

      return currentSnapshot === undefined ? undefined : now() - currentSnapshot.eventTimeMs;
    },
    snapshot: () => sync?.snapshot()
  };
}
