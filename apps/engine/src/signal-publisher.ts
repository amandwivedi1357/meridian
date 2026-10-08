import { streams, type RedisStreamClient } from "@meridian/bus";
import { createSignal, serializeSignal, type Signal } from "@meridian/core";

export interface SignalPublisherDeps {
  readonly bus: Pick<RedisStreamClient, "xAdd">;
}

export async function publishSignal(
  input: Signal,
  deps: SignalPublisherDeps
): Promise<string> {
  const signal = createSignal(input);

  return deps.bus.xAdd(streams.signals, "*", {
    kind: "signal",
    signalId: signal.signalId,
    payload: JSON.stringify(serializeSignal(signal))
  });
}
