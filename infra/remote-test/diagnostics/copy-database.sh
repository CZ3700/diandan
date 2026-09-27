#!/usr/bin/env bash
# Copy a remote TEST instance database into a scratch database and apply candidate SQL there only,
# so a fix can be proven against real data without touching the live database.
# Usage (as the runtime user): copy-database.sh [candidate.sql ...]   |   copy-database.sh --drop
# Environment: INSTANCE (default stg), APP_ROOT (default /home/xiadan/app), DIAG_DB (default diag_payments).
set -euo pipefail
APP_ROOT=${APP_ROOT:-/home/xiadan/app}
INSTANCE=${INSTANCE:-stg}
DIAG_DB=${DIAG_DB:-diag_payments}
CFG="$APP_ROOT/node_modules/.cache/fan-support-local-experience/$INSTANCE/config.json"
BIN=/usr/lib/postgresql/18/bin
export PGHOST=127.0.0.1
export PGPORT=$(node -e "console.log(require('$CFG').ports.postgres)")
export PGUSER=$(node -e "console.log(require('$CFG').database.user)")
export PGPASSWORD=$(node -e "console.log(require('$CFG').database.password)")
SOURCE=$(node -e "console.log(require('$CFG').database.database)")
if [ "$SOURCE" = "$DIAG_DB" ]; then echo "refusing: scratch name equals the live database" >&2; exit 2; fi
"$BIN/dropdb" --if-exists "$DIAG_DB"
if [ "${1:-}" = "--drop" ]; then echo "scratch copy dropped"; exit 0; fi
"$BIN/createdb" "$DIAG_DB"
"$BIN/pg_dump" -Fc "$SOURCE" | "$BIN/pg_restore" -d "$DIAG_DB" --no-owner --exit-on-error
for sql in "$@"; do "$BIN/psql" -d "$DIAG_DB" -v ON_ERROR_STOP=1 -q -f "$sql"; done
echo "scratch copy $DIAG_DB ready; candidate files applied: $#"
