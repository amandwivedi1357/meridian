import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { ApiAuthConfig } from "./auth.js";
import { registerApiAuth } from "./auth.js";
import { registerAccountSummaryRoutes } from "../features/account/account-summary.js";
import { registerDashboard } from "../features/dashboard/dashboard.js";
import { registerFillsRoutes } from "../features/fills/fills.js";
import { registerMarketCandlesRoutes } from "../features/market/candles.js";
import { registerOrdersRoutes } from "../features/orders/orders.js";
import { registerPositionsRoutes } from "../features/positions/positions.js";
import { registerRiskControlRoutes } from "../features/risk/risk-control.js";
import { registerRiskEventsRoutes } from "../features/risk/risk-events.js";
import { registerRiskStateRoutes } from "../features/risk/risk-state.js";
import { registerStrategyControlRoutes } from "../features/strategies/strategy-control.js";
import { registerStrategiesRoutes } from "../features/strategies/strategies.js";
import { registerTradingState } from "../features/trading-state/trading-state.js";

interface ApiRedis {
  readonly xRevRange: (
    key: string,
    start: string,
    end: string,
    options: { COUNT: number }
  ) => Promise<{ message: Record<string, string> }[] | null>;
  readonly xLen: (key: string) => Promise<number>;
  readonly info: (section: string) => Promise<string>;
  readonly sendCommand: (args: readonly string[]) => Promise<unknown>;
}

export function registerApiRoutes(
  server: FastifyInstance,
  deps: {
    readonly auth: ApiAuthConfig;
    readonly redis: ApiRedis;
    readonly pool: Pool;
    readonly workspace: string;
  }
): void {
  registerApiAuth(server, deps.auth);
  registerDashboard(server, deps.redis, deps.pool, deps.workspace);
  registerMarketCandlesRoutes(server, deps.pool);
  registerTradingState(server, deps.pool);
  registerOrdersRoutes(server, deps.pool);
  registerFillsRoutes(server, deps.pool);
  registerRiskEventsRoutes(server, deps.pool);
  registerRiskStateRoutes(server, deps.pool);
  registerRiskControlRoutes(server, deps.pool, deps.redis);
  registerPositionsRoutes(server, deps.pool);
  registerAccountSummaryRoutes(server, deps.pool);
  registerStrategiesRoutes(server, deps.pool);
  registerStrategyControlRoutes(server, deps.pool);
}
