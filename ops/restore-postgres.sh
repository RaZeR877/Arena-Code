#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then echo 'Usage: ops/restore-postgres.sh /path/to/arena.dump' >&2; exit 2; fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP="$(realpath "$1")"
read -r -p 'This will replace data in the configured database. Type RESTORE to continue: ' CONFIRM
[[ "$CONFIRM" == RESTORE ]] || { echo 'Cancelled'; exit 1; }
# Never restore into an untrusted or shared database.
docker compose -f "$ROOT/deploy/compose.yaml" exec -T db sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl --single-transaction' < "$BACKUP"
echo 'Restore completed. Verify workspace and login behavior before reopening access.'
