#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or later is required." >&2
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || { echo "Node.js 20 or later is required." >&2; exit 1; }
exec node server.js
