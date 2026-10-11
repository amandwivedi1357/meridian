# Application Containers

Phase 5 image packaging is separate from HTTPS deployment, provider secret storage,
CD, backups, live trading acceptance and the unresolved dedicated-host latency gate.
Node and NGINX base images are pinned by verified registry digest; update those
digests deliberately and rerun image checks when taking security updates.

## Images

`infra/containers/Dockerfile.node` builds API, Ingestor, Engine, Executor and the
Backtest Worker from the frozen workspace lockfile with pnpm 9.12.3. Dependency
builds precede `pnpm deploy --prod`. Only compiled workspace artifacts are packaged;
compiled test files are removed. Builder-only manifest changes do not touch the
repository manifests. Runtime uses Node 22 Alpine and UID 1000, with no installed
TypeScript, tsx, Vitest, ESLint or testcontainers dependencies.

`infra/containers/Dockerfile.web` builds Vite assets and serves them with
[NGINX's unprivileged image](https://github.com/nginx/docker-nginx-unprivileged)
as UID 101 on port 8080. The same-origin `/api/` proxy preserves authentication
headers and cookies; [response buffering is disabled](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering)
and its read timeout accommodates SSE heartbeats. Static asset misses return 404,
while application routes fall back to the SPA. TLS termination is not implemented here.

`.dockerignore` uses an allowlisted workspace context, excluding local dependencies,
compiled outputs, `.env*`, private-key file extensions, Git, sessions and logs.
No secret is passed as a build argument. This is not a claim that arbitrary
hardcoded secrets in source have been audited; the existing secret-scanning gates
remain necessary. Build tools stay in the builder stage, not the runtime stage.

## Build And Verify

Verified locally on 2026-10-11: all nine container checkpoints, eight Linux
entrypoint tests and 22 focused API regressions pass. Node image sizes are
243-282 MiB and Web is 78 MiB (uncompressed Docker sizes, rounded). Final evidence:
`logs/verification/phase-5/meridian-images-0ca10569129f401ba0430ff012b1e886/result.json`.
Fixture cleanup completed; existing shared services and safety state were untouched.

From the repository root, with Docker Desktop running:

```powershell
node scripts/verify-containers.cjs
```

This builds all six `meridian/<service>:local` images, checks non-root users,
production dependency resolution and clean compiled workspace artifacts, and
records exact image IDs and uncompressed Docker sizes. A 512 MiB per-image ceiling
is a packaging sanity check, not a TRD performance target.

The verification uses an internal UUID-labeled Docker network, dummy credentials,
disposable Redis/Timescale and no published ports, checkout-root or secret mounts.
Only the credential-free entrypoint/test files are mounted read-only for eight
Linux guard/exit-code tests, including a signal-killed child returning 143 rather
than false success. It verifies
API/Web startup and readiness, real static assets, authenticated proxy access,
initial unbuffered account SSE, Backtest CLI migrations/listing, packaged job-child
loading with an absent claim, trading startup guards, and clean SIGTERM exits.
The Ingestor cannot reach an upstream exchange there: liveness must pass and
readiness must report unavailable, not pretend that public ingestion was verified.
Engine/Executor trading loops are not activated. Results and failure logs are saved
under ignored `logs/verification/phase-5/meridian-images-<uuid>/`.

```powershell
node scripts/verify-containers.cjs --skip-build
```

Use `--skip-build` only to check already-built images; image IDs are recorded so
that old binaries are not mistaken for verification of current source. Containers,
anonymous fixture volumes and networks are removed after checking ownership.
Built application images remain available for reuse.

## Compose Overlay

`infra/docker-compose.apps.yml` overlays the existing infrastructure Compose file.
It does not replace or migrate an existing stack automatically. API/Web are the
default app services; `market`, `trading` and `jobs` are explicit opt-in profiles.
Node containers have read-only roots, dropped capabilities, no-new-privileges and
bounded writable tmpfs paths. Reports/logs in those tmpfs paths are ephemeral;
long-lived report/recording storage and backups need a separately configured volume.

Before a real deployment, provision a strong `JWT_SECRET`, separate API credentials,
explicit HTTPS `API_ALLOWED_ORIGINS`, and a TLS reverse proxy. The API retains its
production HTTPS-origin/credential checks and Secure session cookies. The loopback
8080 binding is not itself a finished browser-authenticated HTTPS deployment.
Secrets must eventually come from the provider secret store, not image layers or
a publicly committed Compose environment. Avoid printing rendered Compose config.

```powershell
docker compose -f infra/docker-compose.yml -f infra/docker-compose.apps.yml build api web
```

On a deliberately selected/migrated stack, the one-off Backtest CLI can apply the
existing forward migrations before API startup:

```powershell
docker compose -f infra/docker-compose.yml -f infra/docker-compose.apps.yml --profile jobs run --rm backtest-worker list
docker compose -f infra/docker-compose.yml -f infra/docker-compose.apps.yml up -d api web
```

Do not run those startup/migration commands against shared storage casually. They
were not run against the current development stack during image verification.
Also do not enable the container Ingestor while the Windows feed owns the same Redis
lease; choose one supervisor. Diagnostics listen internally on 9400-9403 and are not
published. Container scrape/probe wiring is provided by the overlay and the
profile-aware generator described below; applying it to a selected deployment
remains an explicit operator action.

## Container Observability

Before starting monitoring on a deliberately selected stack, render its configuration
with the same `COMPOSE_PROFILES` that Compose will use. Do not independently add
`--profile` flags afterward without regenerating: optional services could otherwise
run unmonitored. For example, market ingestion plus Telegram delivery:

```powershell
$env:COMPOSE_PROFILES='market,alerts'
node scripts/containers/observability-config.cjs
docker compose -f infra/docker-compose.yml -f infra/docker-compose.apps.yml up -d --no-deps blackbox prometheus grafana alertmanager
```

This requires the selected API/Web/feed/storage services and private Alertmanager
config already running/provisioned. It is not an instruction to switch the current
Windows dashboard to container ingestion or migrate shared storage. The generator
writes non-secret ignored `infra/prometheus/.local/prometheus.yml`; Compose replaces
only the scraper configuration mount, retaining rules/data volumes. Default targets
are API/Web; `market` adds the feed; `trading` adds Engine/Executor. Unselected
services have no scrape targets, not fictional healthy values. `alerts` adds real
Alertmanager delivery; without it no unreachable alert destination is configured.

Node runtime metrics use Docker DNS on 9400-9403, not host ports. The private
Prometheus Blackbox Exporter probes both liveness/readiness for every selected
long-running application. Web readiness verifies the static entry artifact; API
readiness is separately probed, not implied by Web readiness. A reachable exporter
with a failed application probe is still unhealthy (`probe_success=0`).

The Containers Grafana dashboard adds six panels for probes, scrapes, sample
validity and durable worker/dispatcher state. Ledger sample failure clears financial
series and exports availability zero; a separate stale-sample rule catches stalled
refreshes. Two new rules bring the total to sixteen. Blackbox probe success is gated
by scraper health in the dashboard so old green samples are not reused after failure.

Short-lived Backtest CLI/job processes have no permanent HTTP daemon. API dispatcher
readiness, process outcomes/durations, active children and committed DB job states
remain their supported monitoring contract. No standalone-worker fake `up=1` exists.
Before activating trading, set `TELEGRAM_TRADING_ALERTS=true`, regenerate the private
Telegram config and reload Alertmanager; default local-only routing suppresses both
runtime and health-probe alerts for intentionally inactive trading services.

`node scripts/verify-container-observability.cjs` verifies actual isolated API/feed/
Web images, private Prometheus and four provisioned Grafana dashboards. It then stops
and restores only disposable Redis and verifies production rule firing/resolution
through a separate Alertmanager to two real Telegram API-accepted notifications.
It reuses the existing private destination without exposing its token. Only monitoring
tools receive an egress network attachment; exchange-capable apps stay internal.
Screenshots/non-secret reports go to ignored verification logs; the temporary secret
file stays under ignored Alertmanager storage and is removed during ownership-checked
cleanup. Real Engine/Executor trading, live upstream ingestion, production networking/
secret-store acceptance and human notification receipt are not established by this test.

Both Engine and Executor refuse startup with exit 78 unless
`MERIDIAN_ENABLE_TRADING=testnet-confirmed` and `BINANCE_ENV=testnet`. Their profile
alone cannot activate trading, and production is refused even with confirmation.
The durable kill switch is never reset by the entrypoint. Operator activation,
credentials and explicit risk/allocation configuration remain separate decisions.
Standalone Backtest Worker is a short-lived CLI, so its `cli` image deliberately
has no fake daemon healthcheck. MCP packaging is deferred with Phase 6.
