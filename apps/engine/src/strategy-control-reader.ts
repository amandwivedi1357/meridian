export interface StrategyControlQuery {
  readonly query: (query: {
    readonly text: string;
    readonly values: readonly unknown[];
  }) => Promise<{
    readonly rows: readonly unknown[];
  }>;
}

export function createStrategyControlReader(deps: StrategyControlQuery) {
  return {
    async isPaused(strategyId: string): Promise<boolean> {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(strategyId)) {
        throw new Error("Invalid strategy id");
      }

      const result = await deps.query({
        text: "SELECT paused FROM strategy_control_state WHERE strategy_id = $1",
        values: [strategyId]
      });
      const row = result.rows[0];
      if (row === undefined) return false;
      if (typeof row !== "object" || row === null || !("paused" in row)) {
        throw new Error("Invalid strategy control state row");
      }
      const paused = (row as Record<string, unknown>).paused;
      if (typeof paused !== "boolean") throw new Error("Invalid strategy control state row");
      return paused;
    }
  };
}
