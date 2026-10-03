# Meridian Code Setup

Use this file to set up Meridian on a new machine, such as a laptop.

## Repository

Personal GitHub remote:

```txt
git@github.com:amandwivedi1357/meridian.git
```

## Prerequisites

Install:

- Git
- Node.js LTS
- pnpm
- Docker Desktop, needed later for Redis, TimescaleDB, Prometheus, and Grafana

Check versions:

```bash
git --version
node --version
pnpm --version
docker --version
```

If pnpm is missing:

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
```

## GitHub SSH Setup

Generate a personal GitHub SSH key:

```bash
ssh-keygen -t ed25519 -C "amandwivedi1357@gmail.com"
```

Print the public key:

```bash
cat ~/.ssh/id_ed25519.pub
```

Add the full public key line to:

```txt
GitHub -> Settings -> SSH and GPG keys -> New SSH key
```

Test:

```bash
ssh -T git@github.com
```

Expected result:

```txt
Hi amandwivedi1357! You've successfully authenticated, but GitHub does not provide shell access.
```

## Clone

```bash
git clone git@github.com:amandwivedi1357/meridian.git
cd meridian
```

## Install

```bash
pnpm install
```

## Verify Current Baseline

Run the package that has the latest completed work:

```bash
pnpm --filter @meridian/binance-client typecheck
pnpm --filter @meridian/binance-client test
```

Expected baseline:

```txt
Typecheck passes.
35 tests pass across 10 test files.
```

If continuing Phase 1.4 ingestor work, also run:

```bash
pnpm --filter @meridian/ingestor typecheck
pnpm --filter @meridian/ingestor test
```

The ingestor tests may be red if Phase 1.4 implementation is in progress.

## Environment Files

`.env` is intentionally not committed.

If needed:

```bash
cp .env.example .env
```

Then fill local values manually.

Do not commit `.env`.

## Docker Infra

When infrastructure is needed:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Check:

```bash
docker compose -f infra/docker-compose.yml ps
```

Stop:

```bash
docker compose -f infra/docker-compose.yml down
```

## Resume With Codex

Use this first message in a new Codex chat:

```txt
Read docs/current-state.md and docs/implementation-plan.md, then continue from Phase 1.4. I will write implementation code; you guide me and write/update tests.
```

## Working Agreement

- User writes implementation code unless explicitly asking Codex to code.
- Codex guides with file names, code direction, and explanations.
- Codex writes or updates tests for new behavior.
- Codex updates progress docs after meaningful milestones.
- Use Hinglish explanations when helpful.

## Current Next Work

Continue Phase 1.4:

- validate and normalize trade, kline, and depth events
- publish normalized events to Redis Streams
- batch write trades and klines to TimescaleDB
- deduplicate events
- add historical kline backfill CLI

Source of truth:

- `docs/current-state.md`
- `docs/implementation-plan.md`
