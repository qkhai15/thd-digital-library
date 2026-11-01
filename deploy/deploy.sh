#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.production ]; then
  echo "Thiếu deploy/.env.production"
  echo "Hãy copy .env.production.example thành .env.production rồi sửa mật khẩu."
  exit 1
fi

mkdir -p data/uploads

docker compose --env-file .env.production -f docker-compose.prod.yml build app
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait db

echo ""
echo "Tạo/kiểm tra bảng database..."
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps app node scripts/setup-db.mjs
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --wait app caddy

echo ""
docker compose --env-file .env.production -f docker-compose.prod.yml ps

echo ""
echo "XONG:"
echo "https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/"
