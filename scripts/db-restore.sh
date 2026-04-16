#!/bin/bash
# Restore PostgreSQL from the most recent backup (or a specific file)
# Usage: ./scripts/db-restore.sh [backup_file]

set -e

BACKUP_DIR="$(dirname "$0")/../data/backups"

if [ -n "$1" ]; then
  BACKUP_FILE="$1"
else
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/ai_studio_*.sql 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: No backup file found"
  echo "Usage: $0 [backup_file]"
  echo "Available backups:"
  ls -lt "$BACKUP_DIR"/ai_studio_*.sql 2>/dev/null | head -5
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Restoring from: $BACKUP_FILE ($SIZE)"
echo "This will OVERWRITE the current database. Press Ctrl+C to cancel."
sleep 3

PGPASSWORD=ai_studio psql -h localhost -U ai_studio -d ai_studio < "$BACKUP_FILE"

echo "Restore complete."
PGPASSWORD=ai_studio psql -h localhost -U ai_studio -d ai_studio -c "SELECT COUNT(*) as prds FROM prds; SELECT COUNT(*) as tasks FROM tasks;"
