#!/bin/bash
# DClaw PG 还原脚本
# 使用: npm run restore:pg <备份文件.sql.gz|.sql> [--force]
#   环境变量覆盖: PG_CONTAINER / PG_DB / PG_USER
#   --force: 跳过交互确认（脚本化用途，请谨慎）
set -e

FORCE=""
FILE=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) FILE="$arg" ;;
  esac
done

if [ -z "$FILE" ]; then
  echo "用法: $0 <备份文件.sql.gz|.sql> [--force]"
  echo ""
  echo "列出可用备份:"
  ls -1 backups/dclaw-*.sql.gz 2>/dev/null || echo "  (无备份)"
  exit 1
fi

CONTAINER="${PG_CONTAINER:-dclaw-postgres}"
DB="${PG_DB:-dclaw}"
USER="${PG_USER:-dclaw}"

if [ ! -f "$FILE" ]; then
  echo "❌ 文件不存在: $FILE"
  exit 1
fi

echo "⚠️  即将还原备份到 $DB@$CONTAINER，现有数据会被覆盖 (--clean --if-exists)"
echo "    备份文件: $FILE"
if [ -z "$FORCE" ]; then
  read -p "确认继续? (yes/NO): " ok
  if [ "$ok" != "yes" ]; then
    echo "已取消"
    exit 0
  fi
fi

echo "🔄 还原中..."
if [[ "$FILE" == *.gz ]]; then
  gunzip -c "$FILE" | docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB"
else
  cat "$FILE" | docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB"
fi

echo "✅ 还原完成，行数概览:"
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "
  SELECT 'projects' AS tbl, COUNT(*) FROM projects
  UNION ALL SELECT 'servers', COUNT(*) FROM servers
  UNION ALL SELECT 'connections', COUNT(*) FROM connections
  UNION ALL SELECT 'users', COUNT(*) FROM users;
" 2>/dev/null || echo "  (部分表可能不存在，跳过统计)"
