import type { FastifyInstance } from "fastify";
import type { PortfolioReader } from "../account/portfolio.js";

export function registerPositionsRoutes(server: FastifyInstance, portfolio: PortfolioReader): void {
  server.get("/api/positions", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      return await portfolio();
    } catch {
      return reply
        .code(503)
        .send({ error: "positions_unavailable", message: "Positions are unavailable" });
    }
  });
}
