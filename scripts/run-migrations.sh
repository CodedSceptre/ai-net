#!/usr/bin/env bash
# run-migrations.sh — Phased migration runner for the ai-net backend.
#
# Usage:
#   scripts/run-migrations.sh --phase expand
#   scripts/run-migrations.sh --phase contract
#
# Modes:
#   expand    Run only *.expand.ts migrations (additive, safe before deploy)
#   contract  Run only *.contract.ts migrations (destructive, safe after deploy)
#
# The script exits non-zero on the first migration failure, logging the name
# and wall-clock duration of every migration it attempts.

set -euo pipefail

PHASE=""
BACKEND_DIR="$(cd "$(dirname "$0")/../backend" && pwd)"
MIGRATIONS_DIR="${BACKEND_DIR}/src/db/migrations"
LOG_PREFIX="[run-migrations]"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      PHASE="$2"
      shift 2
      ;;
    *)
      echo "${LOG_PREFIX} Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${PHASE}" ]]; then
  echo "${LOG_PREFIX} ERROR: --phase <expand|contract> is required." >&2
  exit 1
fi

if [[ "${PHASE}" != "expand" && "${PHASE}" != "contract" ]]; then
  echo "${LOG_PREFIX} ERROR: --phase must be 'expand' or 'contract', got '${PHASE}'." >&2
  exit 1
fi

echo "${LOG_PREFIX} Starting ${PHASE} phase migrations..."

# ── Find migration files ──────────────────────────────────────────────────────
# Pattern: YYYYMMDD_HHMMSS_name.<phase>.ts  (sorted lexicographically = chronologically)
mapfile -t MIGRATION_FILES < <(
  find "${MIGRATIONS_DIR}" -type f -name "*.${PHASE}.ts" | sort
)

if [[ ${#MIGRATION_FILES[@]} -eq 0 ]]; then
  echo "${LOG_PREFIX} No ${PHASE} migrations found — nothing to do."
  exit 0
fi

echo "${LOG_PREFIX} Found ${#MIGRATION_FILES[@]} ${PHASE} migration(s)."

# ── Run each migration ────────────────────────────────────────────────────────
FAILED=0
for MIGRATION_FILE in "${MIGRATION_FILES[@]}"; do
  MIGRATION_NAME="$(basename "${MIGRATION_FILE}")"
  START_TS=$(date +%s%3N)

  echo "${LOG_PREFIX} Running: ${MIGRATION_NAME} ..."

  if npx tsx "${MIGRATION_FILE}" 2>&1; then
    END_TS=$(date +%s%3N)
    DURATION=$(( END_TS - START_TS ))
    echo "${LOG_PREFIX} ✓ ${MIGRATION_NAME} completed in ${DURATION}ms"
  else
    END_TS=$(date +%s%3N)
    DURATION=$(( END_TS - START_TS ))
    echo "${LOG_PREFIX} ✗ ${MIGRATION_NAME} FAILED after ${DURATION}ms" >&2
    FAILED=1
    break
  fi
done

if [[ "${FAILED}" -eq 1 ]]; then
  echo "${LOG_PREFIX} ERROR: ${PHASE} phase aborted — migration failed." >&2
  exit 1
fi

echo "${LOG_PREFIX} All ${PHASE} migrations completed successfully."
