/* global __dirname */
const fs = require("node:fs/promises");
const path = require("node:path");

function containerConfig(profiles = []) {
  if (profiles.some((p) => !["market", "trading", "jobs", "alerts"].includes(p))) {
    throw new Error("Unknown application profile");
  }
  const services = [
    { name: "api", port: 9400 },
    { name: "web", port: 8080 }
  ];
  if (profiles.includes("market")) services.push({ name: "ingestor", port: 9401 });
  if (profiles.includes("trading"))
    services.push({ name: "engine", port: 9402 }, { name: "executor", port: 9403 });
  return {
    global: { scrape_interval: "15s", evaluation_interval: "15s" },
    alerting: {
      alertmanagers: profiles.includes("alerts")
        ? [{ static_configs: [{ targets: ["alertmanager:9093"] }] }]
        : []
    },
    rule_files: ["/etc/prometheus/rules/*.yml"],
    scrape_configs: [
      { job_name: "prometheus", static_configs: [{ targets: ["localhost:9090"] }] },
      ...(profiles.includes("alerts")
        ? [{ job_name: "alertmanager", static_configs: [{ targets: ["alertmanager:9093"] }] }]
        : []),
      { job_name: "blackbox", static_configs: [{ targets: ["blackbox:9115"] }] },
      ...services
        .filter((s) => s.name !== "web")
        .map((s) => ({
          job_name: `meridian-${s.name}`,
          scrape_timeout: "5s",
          static_configs: [
            { targets: [`${s.name}:${s.port}`], labels: { deployment: "container" } }
          ]
        })),
      {
        job_name: "meridian-health",
        metrics_path: "/probe",
        scrape_timeout: "5s",
        params: { module: ["http_2xx"] },
        static_configs: services.flatMap((s) =>
          ["live", "ready"].map((check) => ({
            targets: [`http://${s.name}:${s.port}/health/${check}`],
            labels: { service: s.name, check, deployment: "container" }
          }))
        ),
        relabel_configs: [
          { source_labels: ["__address__"], target_label: "__param_target" },
          { source_labels: ["__param_target"], target_label: "instance" },
          { target_label: "__address__", replacement: "blackbox:9115" }
        ]
      }
    ]
  };
}
module.exports = { containerConfig };
if (require.main === module) {
  const profiles = (process.env.COMPOSE_PROFILES ?? "").split(",").filter(Boolean);
  const directory = path.resolve(__dirname, "../../infra/prometheus/.local");
  Promise.resolve()
    .then(async () => {
      const config = containerConfig(profiles);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "prometheus.yml"), JSON.stringify(config, null, 2));
      console.log(
        JSON.stringify({
          configured: true,
          profiles,
          services: config.scrape_configs
            .filter((s) => s.job_name.startsWith("meridian-"))
            .map((s) => s.job_name)
        })
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
