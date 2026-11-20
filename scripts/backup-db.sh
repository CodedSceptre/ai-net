#!/usr/bin/env bash
# backup-db.sh — hot-backup all three ai-net SQLite databases, compress, and
# upload to S3 with server-side encryption.
#
# Environment variables:
#   DB_DIR     — directory containing the .db files (default: /app/data)
#   S3_BUCKET  — target S3 bucket name           (default: ai-net-backups)
#
# Exit codes:
#   0 — all databases backed up and uploaded successfully
#   1 — one or more steps failed
#
# Issue #725

set -euo pipefail

DB_DIR="${DB_DIR:-/app/data}"
S3_BUCKET="${S3_BUCKET:-ai-net-backups}"
BACKUP_TMP="/tmp/ai-net-backup"
DATE="$(date +%Y-%m-%d)"
DATABASES=(payments.db agents.db tasks.db)

echo "[backup] Starting database backup — date: $DATE"
echo "[backup] DB_DIR: $DB_DIR  S3_BUCKET: $S3_BUCKET"

mkdir -p "$BACKUP_TMP"

for DB in "${DATABASES[@]}"; do
  SOURCE="$DB_DIR/$DB"
  DEST="$BACKUP_TMP/$DB"
  COMPRESSED="$BACKUP_TMP/${DB}.gz"
  S3_KEY="$DATE/${DB}.gz"

  if [ ! -f "$SOURCE" ]; then
    echo "[backup] WARNING: $SOURCE not found — skipping" >&2
    continue
  fi

  echo "[backup] Backing up $DB ..."
  sqlite3 "$SOURCE" ".backup $DEST"

  echo "[backup] Compressing $DB ..."
  gzip -f "$DEST"

  SIZE=$(du -sh "$COMPRESSED" | cut -f1)
  echo "[backup] Uploading ${DB}.gz ($SIZE) → s3://$S3_BUCKET/$S3_KEY"

  aws s3 cp "$COMPRESSED" "s3://$S3_BUCKET/$S3_KEY" \
    --sse AES256 \
    --no-progress

  echo "[backup] ✓ $DB uploaded successfully ($SIZE)"
done

echo "[backup] All databases backed up successfully"
rm -rf "$BACKUP_TMP"
