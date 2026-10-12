# Database Backups

Meridian backups are operator-run in this phase. The tooling creates a PostgreSQL
custom-format dump from the local Timescale Compose service and verifies it by
restoring into a disposable database inside the same service.

This is not a hosted nightly schedule, offsite retention policy, or provider secret
store integration yet.

## Create A Backup

Start the local infrastructure first:

```powershell
docker compose -f infra/docker-compose.yml up -d timescaledb
```

Then run:

```powershell
pnpm db:backup
```

The output is written under ignored `backups/`, for example:

```json
{
  "ok": true,
  "command": "backup",
  "backup": "backups/meridian-20261012T102030Z.dump",
  "bytes": 123456,
  "format": "pg_dump-custom"
}
```

To choose an explicit file:

```powershell
pnpm db:backup -- --out backups/manual-before-upgrade.dump
```

The script refuses output paths outside the repository. Do not commit backup files.
They may contain strategy, account, audit, order and fill history.

## Verify A Backup

Run verification after each backup:

```powershell
pnpm db:backup:verify -- --file backups/manual-before-upgrade.dump
```

Verification creates a temporary database named like
`meridian_restore_verify_<token>`, restores the dump with `pg_restore
--exit-on-error`, checks core tables and migration metadata, then drops the
temporary database.

The check proves:

- the dump can be read by `pg_restore`
- schema objects restore into a fresh database
- core Meridian tables are present
- `schema_migrations` is present and readable

The check does not prove:

- a cloud/provider backup schedule exists
- offsite retention exists
- point-in-time recovery is configured
- production secrets or TLS deployment are complete
- every restored row has been semantically reconciled with an exchange account

## Custom Compose Options

Defaults match the local stack:

```powershell
pnpm db:backup -- --compose-file infra/docker-compose.yml --service timescaledb --user meridian --database meridian
pnpm db:backup:verify -- --file backups/manual.dump --compose-file infra/docker-compose.yml --service timescaledb --user meridian --database meridian
```

The script runs `pg_dump`, `createdb`, `pg_restore`, `psql`, and `dropdb` inside
the Compose service, so the host machine does not need PostgreSQL client tools.

## Scheduled Runner

Use the scheduled runner from cron, Windows Task Scheduler, a provider job, or a
deployment platform scheduler:

```powershell
pnpm db:backup:scheduled
```

It performs the full local acceptance sequence:

1. create a timestamped backup under ignored `backups/`
2. restore that backup into a disposable database
3. check core schema and migration metadata
4. write an evidence JSON file under ignored `logs/verification/phase-5/backups/`
5. prune old local dumps, keeping the newest seven by default

Use `--keep-local` to change the local retention count:

```powershell
pnpm db:backup:scheduled -- --keep-local 14
```

Use `--manifest-out` when a scheduler expects a stable output path:

```powershell
pnpm db:backup:scheduled -- --manifest-out logs/verification/phase-5/backups/latest.json
```

The command exits nonzero if backup creation or restore verification fails. In a
real deployment, configure the scheduler/provider to alert on that nonzero exit
and ship the dump to private durable storage after the command succeeds.

## Next Production Work

For full Phase 5 acceptance, add a provider-backed scheduled job that runs the
scheduled runner, uploads the verified dump to private durable storage, applies
remote retention, alerts on failure, and periodically restores into disposable
infrastructure. Keep the restore evidence separate from the backup artifact itself.
