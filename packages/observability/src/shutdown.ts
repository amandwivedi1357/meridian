export function shutdownTimeout(env: Record<string, string | undefined> = process.env): number {
  const value = env.SHUTDOWN_TIMEOUT_MS ?? "15000";
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 100 || parsed > 120000)
    throw new Error("SHUTDOWN_TIMEOUT_MS must be an integer from 100 to 120000");
  return parsed;
}

export function createShutdownGuard(options: {
  onStop: () => void;
  timeoutMs?: number;
  forceExit?: (code: number) => void;
}) {
  const timeoutMs = options.timeoutMs ?? shutdownTimeout();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000)
    throw new Error("Invalid shutdown timeout");
  const exit = options.forceExit ?? ((code: number) => process.exit(code));
  let stopping = false;
  let finished = false;
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (stopping || finished) return;
    stopping = true;
    // Arm before stopping work; keep the deadline through runtime drain and resource cleanup.
    timer = setTimeout(() => exit(1), timeoutMs);
    try {
      options.onStop();
    } catch {
      exit(1);
    }
  };
  process.on("SIGINT", request);
  process.on("SIGTERM", request);
  return {
    request,
    finish() {
      finished = true;
      clearTimeout(timer);
      process.off("SIGINT", request);
      process.off("SIGTERM", request);
    }
  };
}
