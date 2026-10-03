import type { StreamSubscription } from "./stream-types.js";

export function chunkSubscriptions(
  subscriptions: readonly StreamSubscription[],
  chunkSize: number
): readonly (readonly StreamSubscription[])[] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }

  const chunks: StreamSubscription[][] = [];
  for (let index = 0; index < subscriptions.length; index += chunkSize) {
    chunks.push([...subscriptions.slice(index, index + chunkSize)]);
  }
  return chunks;
}
