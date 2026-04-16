#!/bin/bash
# Auto-backup PostgreSQL data before risky operations
# Stores backups in data/backups/ with timestamps

set -e

BACKUP_DIR="$(dirname "$0")/../data/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ai_studio_$TIMESTAMP.sql"

echo "Backing up ai_studio database to $BACKUP_FILE..."

PGPASSWORD=ai_studio pg_dump -h localhost -U ai_studio ai_studio > "$BACKUP_FILE" 2>/dev/null

if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "Backup complete: $BACKUP_FILE ($SIZE)"

  # Keep only last 10 backups
  ls -t "$BACKUP_DIR"/ai_studio_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null
else
  echo "WARNING: Backup failed or empty — database may be empty"
  rm -f "$BACKUP_FILE"
fi
