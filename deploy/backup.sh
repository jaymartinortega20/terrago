#!/bin/sh
# Nightly PostgreSQL backup for the TerraGo VPS.
#   crontab:  15 3 * * *  /opt/terrago/deploy/backup.sh >> /var/log/terrago-backup.log 2>&1
# Copy the dumps OFF the VPS (rclone/S3/B2) — a backup on the same disk is not a backup.
set -eu
cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/terrago}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$BACKUP_DIR/terrago-$STAMP.dump"

docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db \
  pg_dump -U terrago -d terrago --format=custom --compress=6 > "$FILE"

# Verify the dump is readable before trusting it.
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db pg_restore --list < "$FILE" > /dev/null

find "$BACKUP_DIR" -name 'terrago-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"

# Optional off-site copy (configure rclone first):
# rclone copy "$FILE" remote:terrago-backups/
