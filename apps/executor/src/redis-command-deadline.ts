export function createRedisCommandDeadline(options: {
  sendCommand: (args: readonly (string | Buffer)[]) => Promise<unknown>;
  disconnect: () => void;
  timeoutMs: number;
}) {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 2147483647
  )
    throw new Error("Invalid Redis command deadline");
  return async (args: readonly (string | Buffer)[]): Promise<unknown> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        options.sendCommand(args),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            // Reject ALL reads queued on a blackholed socket so the safety loop can run.
            reject(new Error("Executor Redis command timed out"));
            try {
              options.disconnect();
            } catch {
              /* This command still fails closed if the socket already detached. */
            }
          }, options.timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}
