#!/usr/bin/env bash
set -euo pipefail
# Run on the host where Docker Compose is installed. Protect output as sensitive data.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/backups}"
mkdir -p "$DEST"
chmod 700 "$DEST"
FILE="$DEST/arena-$(date -u +%Y%m%dT%H%M%SZ).dump"
TEMP="${FILE}.partial"
trap 'rm -f "$TEMP"' EXIT
umask 077
# PostgreSQL custom format supports pg_restore --list and granular recovery.
docker compose -f "$ROOT/deploy/compose.yaml" exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$TEMP"
test -s "$TEMP"
if command -v pg_restore >/dev/null 2>&1; then pg_restore --list "$TEMP" >/dev/null; fi
mv "$TEMP" "$FILE"
trap - EXIT
printf 'Created encrypted-at-rest-required database backup: %s\n' "$FILE"
printf 'Store off-host securely; this dump contains user account data and projects.\n'
