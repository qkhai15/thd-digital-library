#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data/backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
database_file="data/backups/database-${stamp}.dump"
uploads_file="data/backups/uploads-${stamp}.tar.gz"
# Run during a quiet period so the database and upload snapshots stay consistent.
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$database_file"
tar -czf "$uploads_file" -C data uploads
echo "Backup: $database_file and $uploads_file"
