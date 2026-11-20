#!/usr/bin/env bash
# rollback-migrations.sh — Revert the most recent contract migration batch.
#
# Usage:
#   scripts/rollback-migrations.sh
#   scripts/rollback-migrations.sh --batch-size 2   # revert last N migrations
#
# Only contract migrations are rolled back — expand migrations should never be
# reverted while application code is in service (they are purely additive).
#
# Each *.contract.ts migration must export a `down()` function.  The script
# resolves the last N applied contract migrations and calls `down()` on each,
# in reverse order (newest first).

set -euo pipefail

BATCH_SIZE=1
BACKEND_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
MIGRATIONS_DIR="${BACKEND_DIR}/src/db/migrations"
LOG_PREFIX="[rollback-migrations]"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch-size)
      BATCH_SIZE="$2"
      shift 2
      ;;
    *)
      echo "${LOG_PREFIX} Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

echo "${LOG_PREFIX} Rolling back last ${BATCH_SIZE} contract migration(s)..."

# ── Find contract migration files (sorted descending = newest first) ──────────
mapfile -t ALL_CONTRACT_FILES < <(
  find "${MIGRATIONS_DIR}" -type f -name "*.contract.ts" | sort -r
)

if [[ ${#ALL_CONTRACT_FILES[@]} -eq 0 ]]; then
  echo "${LOG_PREFIX} No contract migrations found — nothing to roll back."
  exit 0
fi

# Take only the last BATCH_SIZE
ROLLBACK_FILES=("${ALL_CONTRACT_FILES[@]:0:${BATCH_SIZE}}")

echo "${LOG_PREFIX} Files to roll back (newest first):"
for f in "${ROLLBACK_FILES[@]}"; do
  echo "  - $(basename "${f}")"
done

# ── Execute rollback ──────────────────────────────────────────────────────────
FAILED=0
for MIGRATION_FILE in "${ROLLBACK_FILES[@]}"; do
  MIGRATION_NAME="$(basename "${MIGRATION_FILE}")"
  START_TS=$(date +%s%3N)

  echo "${LOG_PREFIX} Rolling back: ${MIGRATION_NAME} ..."

  # Call the exported down() function via a small inline script
  if npx tsx --eval "
import { down } from '${MIGRATION_FILE}';
(async () => {
  await down();
  console.log('down() completed');
})().catch(err => { console.error(err); process.exit(1); });
" 2>&1; then
    END_TS=$(date +%s%3N)
    DURATION=$(( END_TS - START_TS ))
    echo "${LOG_PREFIX} ✓ ${MIGRATION_NAME} rolled back in ${DURATION}ms"
  else
    END_TS=$(date +%s%3N)
    DURATION=$(( END_TS - START_TS ))
    echo "${LOG_PREFIX} ✗ ${MIGRATION_NAME} rollback FAILED after ${DURATION}ms" >&2
    FAILED=1
    break
  fi
done

if [[ "${FAILED}" -eq 1 ]]; then
  echo "${LOG_PREFIX} ERROR: Rollback aborted." >&2
  exit 1
fi

echo "${LOG_PREFIX} Rollback completed successfully."
