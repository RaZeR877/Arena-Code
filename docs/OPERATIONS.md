# Hosted operations (v0.7 foundations)

This release is **not certified for public multi-tenant production use**.

## Health and limits

- `/api/health/live`: web-process liveness (not a runner health check).
- `/api/health/ready`: PostgreSQL readiness, returns 503 if database cannot be queried.
- Authenticated `/api/usage`: UTC daily request counts and configured quotas.
- `ARENA_MAX_USER_WORKSPACES` defaults to 20, `ARENA_MAX_USER_CHAT_PER_DAY` to 50, `ARENA_MAX_USER_RUNS_PER_DAY` to 100 and `ARENA_MAX_USER_DEPLOYS_PER_DAY` to 10. A per-day limit of `0` disables that particular daily cap.
- These counters are stored in PostgreSQL. They are per-user quotas, **not** financial limits: token volume, runner CPU seconds and output storage still need metering.

## Backups

From the deployment host, run `ops/backup-postgres.sh /secure/offhost/staging`.
Store backups encrypted in separate storage with restricted access. The dump contains accounts and workspace code. Test recovery on an isolated environment before using the restore script. Run `ops/restore-postgres.sh /path/to/arena.dump` only during a controlled maintenance window and with a verified backup.

## Deployment prerequisites

Use a real dedicated runner host and an audited container isolation boundary; test Docker security controls with the actual daemon. Configure real TLS, DNS, external email, monitoring/alerting, log retention, and backup automation. Validate password reset and email verification before enabling public signup. Deployment webhooks are adapters, not a verified hosted deployment provider. Never publicly expose a development inspector port.

## Known gaps

No integrated email verification/password recovery, full observability stack, audited preview routing, or production disaster-recovery exercise. The benchmark dry run is not a real-model score. Editor language servers and debugger need live browser and container testing. The code is not yet a full Cursor/Replit replacement.
