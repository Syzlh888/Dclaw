#!/bin/bash
# DClaw PG 备份脚本
# 使用: npm run backup:pg
#   环境变量覆盖: BACKUP_DIR / PG_CONTAINER / PG_DB / PG_USER
set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
CONTAINER="${PG_CONTAINER:-dclaw-postgres}"
DB="${PG_DB:-dclaw}"
USER="${PG_USER:-dclaw}"

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/dclaw-$TS.sql"

echo "📦 备份 $DB@$CONTAINER → $OUT.gz"
docker exec "$CONTAINER" pg_dump -U "$USER" -d "$DB" --clean --if-exists > "$OUT"
gzip "$OUT"

# 保留最近 30 天
find "$BACKUP_DIR" -name 'dclaw-*.sql.gz' -mtime +30 -delete 2>/dev/null || true

echo "✅ 备份完成: $OUT.gz"
ls -lh "$OUT.gz"
