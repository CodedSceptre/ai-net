#!/usr/bin/env bash
# =============================================================================
# ai-net Database Backup Script
# =============================================================================
#
# Backs up the three SQLite databases (payments.db, agents.db, tasks.db) to AWS
# S3 with AES-256 encryption, SHA-256 manifest, and failure alerting.
#
# Usage:
#   ./backup-databases.sh [--dry-run]
#
# Required environment variables (see .env.example):
#   S3_BACKUP_BUCKET   — S3 bucket name for backups (e.g. my-ai-net-backups)
#   S3_BACKUP_PREFIX   — S3 key prefix (e.g. backups/sqlite)
#   DB_DIR             — Directory containing the .db files (default: /app/data)
#   ALERT_EMAIL        — Email for failure alerts (optional)
#   SLACK_WEBHOOK_URL  — Slack webhook URL for failure alerts (optional)
#   ENCRYPTION_KEY_ARN — AWS KMS key ARN for server-side encryption (optional,
#                        defaults to AES-256 with S3-managed keys)
#
# Schedule: Run daily at 02:00 UTC via cron or AWS EventBridge + Lambda.
# Retention: 30 days (enforced via S3 lifecycle policy — see docs/DATABASE_BACKUP_DR.md).
#
# Resolves #125
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DRY_RUN=false
EXIT_CODE=0

# Databases to back up
DB_DIR="${DB_DIR:-/app/data}"
DATABASES=("payments.db" "agents.db" "tasks.db")

# S3 destination
S3_BUCKET="${S3_BACKUP_BUCKET:-}"
S3_PREFIX="${S3_BACKUP_PREFIX:-backups/sqlite}"

# Temporary work directory (cleaned up on exit)
WORKDIR="$(mktemp -d)"
MANIFEST_FILE="${WORKDIR}/backup-manifest-${TIMESTAMP}.json"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
error() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: $*" >&2; }

cleanup() {
  log "Cleaning up temporary directory: ${WORKDIR}"
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

send_alert() {
  local subject="$1"
  local body="$2"

  log "Sending failure alert: ${subject}"

  # Slack alert
  if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    curl -s -X POST "${SLACK_WEBHOOK_URL}" \
      -H 'Content-Type: application/json' \
      -d "{\"text\": \"🚨 *ai-net DB Backup Alert*\n*${subject}*\n\`\`\`${body}\`\`\`\"}" \
      || true
  fi

  # Email alert via AWS SES (requires SES setup in the region)
  if [[ -n "${ALERT_EMAIL:-}" ]]; then
    aws ses send-email \
      --from "noreply@ai-net" \
      --to "${ALERT_EMAIL}" \
      --subject "${subject}" \
      --text "${body}" \
      2>/dev/null || true
  fi
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────

log "=== ai-net Database Backup — ${TIMESTAMP} ==="
log "DB_DIR: ${DB_DIR}"
log "S3 destination: s3://${S3_BUCKET}/${S3_PREFIX}/${TIMESTAMP}/"
log "Dry run: ${DRY_RUN}"

if [[ -z "${S3_BUCKET}" ]]; then
  error "S3_BACKUP_BUCKET is not set. Aborting."
  send_alert "Backup failed: ${TIMESTAMP}" "S3_BACKUP_BUCKET environment variable is not configured."
  exit 1
fi

if ! command -v aws &>/dev/null; then
  error "AWS CLI not found. Install it and configure credentials."
  send_alert "Backup failed: ${TIMESTAMP}" "AWS CLI not found on the backup host."
  exit 1
fi

# ── Backup each database ──────────────────────────────────────────────────────

MANIFEST_ENTRIES=()

for DB_NAME in "${DATABASES[@]}"; do
  DB_PATH="${DB_DIR}/${DB_NAME}"

  if [[ ! -f "${DB_PATH}" ]]; then
    error "Database file not found: ${DB_PATH}"
    send_alert "Backup warning: ${TIMESTAMP}" "Expected database file not found: ${DB_PATH}"
    EXIT_CODE=1
    continue
  fi

  log "Backing up: ${DB_NAME}"

  # Create a safe SQLite backup using the .backup command (avoids partial writes)
  BACKUP_FILE="${WORKDIR}/${TIMESTAMP}-${DB_NAME}"
  sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'" \
    || { error "sqlite3 .backup failed for ${DB_NAME}"; EXIT_CODE=1; continue; }

  # Compress
  COMPRESSED_FILE="${BACKUP_FILE}.gz"
  gzip -9 "${BACKUP_FILE}"
  log "Compressed: $(du -sh "${COMPRESSED_FILE}" | cut -f1)"

  # Compute SHA-256 checksum
  CHECKSUM="$(sha256sum "${COMPRESSED_FILE}" | awk '{print $1}')"
  log "SHA-256: ${CHECKSUM}"

  # S3 object key
  S3_KEY="${S3_PREFIX}/${TIMESTAMP}/${TIMESTAMP}-${DB_NAME}.gz"

  if [[ "${DRY_RUN}" == "true" ]]; then
    log "[DRY RUN] Would upload to s3://${S3_BUCKET}/${S3_KEY}"
  else
    # Upload with AES-256 server-side encryption
    if [[ -n "${ENCRYPTION_KEY_ARN:-}" ]]; then
      # Use KMS-managed key
      aws s3 cp "${COMPRESSED_FILE}" "s3://${S3_BUCKET}/${S3_KEY}" \
        --sse aws:kms \
        --sse-kms-key-id "${ENCRYPTION_KEY_ARN}" \
        --metadata "sha256=${CHECKSUM},timestamp=${TIMESTAMP},database=${DB_NAME}"
    else
      # Default: S3-managed AES-256
      aws s3 cp "${COMPRESSED_FILE}" "s3://${S3_BUCKET}/${S3_KEY}" \
        --sse AES256 \
        --metadata "sha256=${CHECKSUM},timestamp=${TIMESTAMP},database=${DB_NAME}"
    fi
    log "Uploaded to s3://${S3_BUCKET}/${S3_KEY}"
  fi

  # Collect manifest entry
  MANIFEST_ENTRIES+=("{\"database\":\"${DB_NAME}\",\"s3_key\":\"${S3_KEY}\",\"sha256\":\"${CHECKSUM}\",\"timestamp\":\"${TIMESTAMP}\"}")
done

# ── Write and upload manifest ─────────────────────────────────────────────────

MANIFEST_JSON="{\"backup_timestamp\":\"${TIMESTAMP}\",\"files\":[$(IFS=,; echo "${MANIFEST_ENTRIES[*]}")]}"
echo "${MANIFEST_JSON}" > "${MANIFEST_FILE}"

MANIFEST_S3_KEY="${S3_PREFIX}/${TIMESTAMP}/manifest.json"

if [[ "${DRY_RUN}" == "true" ]]; then
  log "[DRY RUN] Would upload manifest to s3://${S3_BUCKET}/${MANIFEST_S3_KEY}"
  cat "${MANIFEST_FILE}"
else
  aws s3 cp "${MANIFEST_FILE}" "s3://${S3_BUCKET}/${MANIFEST_S3_KEY}" --sse AES256
  log "Manifest uploaded to s3://${S3_BUCKET}/${MANIFEST_S3_KEY}"
fi

# ── Final status ──────────────────────────────────────────────────────────────

if [[ "${EXIT_CODE}" -ne 0 ]]; then
  send_alert \
    "ai-net DB Backup partially failed — ${TIMESTAMP}" \
    "One or more databases could not be backed up. Check the backup host logs for details."
else
  log "=== Backup completed successfully ==="
fi

exit "${EXIT_CODE}"
