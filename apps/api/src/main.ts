import Fastify from "fastify";

const server = Fastify({ logger: true });

server.get("/health/live", async () => ({ status: "ok" }));
server.get("/health/ready", async () => ({ status: "ok" }));

const port = Number(process.env.API_PORT ?? 3000);

await server.listen({ host: "0.0.0.0", port });
