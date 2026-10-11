import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export const workerHealthSchema = z.object({
  status: z.enum(["ready", "unavailable", "stopping"]),
  lastSuccessfulTickAtMs: z.number().int().nonnegative().nullable(),
  activeChildren: z.number().int().min(0).max(1)
});
export function registerWorkerHealth(
  server: FastifyInstance,
  read: () => z.infer<typeof workerHealthSchema>
) {
  server
    .withTypeProvider<ZodTypeProvider>()
    .get(
      "/api/system/backtest-worker",
      { schema: { tags: ["System"], response: { 200: workerHealthSchema } } },
      async (_request, reply) => {
        reply.header("Cache-Control", "no-store");
        return read();
      }
    );
}
