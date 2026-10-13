import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

import type { ApiAuthConfig } from "./auth.js";
import { registerApiAuth } from "./auth.js";
import { registerAccountSummaryRoutes } from "../features/account/account-summary.js";
import { registerDashboard } from "../features/dashboard/dashboard.js";
import { registerFillsRoutes } from "../features/fills/fills.js";
import { registerMarketCandlesRoutes } from "../features/market/candles.js";
import { registerCancelOrderRoute } from "../features/orders/cancel-order.js";
import { registerManualOrderRoute } from "../features/orders/manual-order.js";
import { registerOrdersRoutes } from "../features/orders/orders.js";
import { registerPositionsRoutes } from "../features/positions/positions.js";
import { registerRiskControlRoutes } from "../features/risk/risk-control.js";
import { registerRiskEventsRoutes } from "../features/risk/risk-events.js";
import { registerRiskStateRoutes } from "../features/risk/risk-state.js";
import { registerStrategyControlRoutes } from "../features/strategies/strategy-control.js";
import { registerStrategiesRoutes } from "../features/strategies/strategies.js";
import { registerTradingState } from "../features/trading-state/trading-state.js";
import { registerBacktests } from "../features/backtests/backtests.js";
import { registerBacktestJobs } from "../features/backtests/jobs.js";
import { registerWorkspaceSummary } from "../features/health/workspace-summary.js";
import { registerPortfolioRoute, type PortfolioReader } from "../features/account/portfolio.js";

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
    readonly portfolio: PortfolioReader;
  }
): void {
  registerApiAuth(server, deps.auth);
  registerPortfolioRoute(server, deps.portfolio);
  registerDashboard(server, deps.redis, deps.pool, deps.workspace);
  registerMarketCandlesRoutes(server, deps.pool);
  registerTradingState(server, deps.pool);
  registerOrdersRoutes(server, deps.pool);
  registerCancelOrderRoute(server, deps.pool);
  registerManualOrderRoute(server, deps.pool, deps.redis);
  registerFillsRoutes(server, deps.pool);
  registerRiskEventsRoutes(server, deps.pool);
  registerRiskStateRoutes(server, deps.pool);
  registerRiskControlRoutes(server, deps.pool, deps.redis);
  registerPositionsRoutes(server, deps.portfolio);
  registerAccountSummaryRoutes(server, deps.pool, deps.portfolio);
  registerStrategiesRoutes(server, deps.pool);
  registerStrategyControlRoutes(server, deps.pool);
  registerBacktests(server, deps.pool);
  registerBacktestJobs(server, deps.pool);
  registerWorkspaceSummary(server, deps.pool);
}
