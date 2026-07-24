/**
 * D3 adapter 单元自测：insert → getById → update → query → remove 全流程
 *
 * 前置：
 *   - PG 已经启动，`GM_MASTER_KEY` + `DB_CONFIG_PATH`（或 DB_HOST 等 env）已配好
 *   - migrations 已通过 `npm run db:migrate` 应用完毕
 *
 * 用法：
 *   node scripts/test-db-adapter.mjs
 *
 * 退出码：0 全通过；非 0 有失败
 */
import 'dotenv/config';
import { nanoid } from 'nanoid';
import {
  initDatabase, getAll, getById, insert, update, remove, query, removeWhere,
} from '../server/database.mjs';
import { closePool } from '../server/db/pool.mjs';

let failures = 0;
function check(label, ok, extra) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}`, extra ?? '');
  }
}

async function main() {
  console.log('=== D3 database.mjs 自测 ===\n');

  console.log('[1] initDatabase()');
  await initDatabase();
  console.log('  ✓ ok\n');

  console.log('[2] insert / getById on platforms');
  const pid = 'test_' + nanoid(6);
  const inserted = await insert('platforms', {
    id: pid, name: '__D3_TEST__', sort_order: 999,
    created_at: new Date().toISOString(),
    // 未知字段 → 走 extra JSONB
    unknownField: 'hello',
    nested: { a: 1, b: 2 },
  });
  check('insert 返回带 id', inserted && inserted.id === pid, inserted);
  check('未知字段扁平化回来', inserted.unknownField === 'hello');
  check('嵌套对象保留', inserted.nested?.a === 1);

  const got = await getById('platforms', pid);
  check('getById 命中', got && got.id === pid);
  check('getById extra 展开', got?.unknownField === 'hello');

  console.log('\n[3] update (patch known + extra merge)');
  const patched = await update('platforms', pid, {
    name: '__D3_TEST_v2__',
    unknownField: 'world',
    newExtra: 42,
  });
  check('update 返回', patched && patched.name === '__D3_TEST_v2__');
  check('update 覆盖 extra 字段', patched?.unknownField === 'world');
  check('update 追加 extra 字段', patched?.newExtra === 42);
  check('update 自动写 updated_at', !!patched?.updated_at);

  console.log('\n[4] query(filterFn)');
  const found = await query('platforms', (p) => p.name === '__D3_TEST_v2__');
  check('query filter 命中', found.length === 1 && found[0].id === pid);

  const notFound = await query('platforms', (p) => p.name === '__DOES_NOT_EXIST__');
  check('query 未命中返回空数组', notFound.length === 0);

  console.log('\n[5] getAll');
  const all = await getAll('platforms');
  check('getAll 是数组', Array.isArray(all));
  check('getAll 包含刚插入的行', all.some((p) => p.id === pid));

  console.log('\n[6] remove');
  const removed = await remove('platforms', pid);
  check('remove 返回 true', removed === true);
  const gone = await getById('platforms', pid);
  check('remove 后 getById 返回 null', gone === null);

  console.log('\n[7] removeWhere');
  // 造 3 条测试数据
  const bulkIds = [];
  for (let i = 0; i < 3; i++) {
    const id = 'bulk_' + nanoid(6);
    bulkIds.push(id);
    await insert('platforms', { id, name: '__BULK__' + i, sort_order: 1000 + i });
  }
  const n = await removeWhere('platforms', (p) => p.name?.startsWith('__BULK__'));
  check('removeWhere 删除 3 条', n === 3);
  const leftover = await query('platforms', (p) => p.name?.startsWith('__BULK__'));
  check('removeWhere 后无残留', leftover.length === 0);

  console.log('\n=== 结果 ===');
  if (failures === 0) {
    console.log('✅ 全部通过');
  } else {
    console.error(`❌ 失败 ${failures} 项`);
  }
}

main()
  .catch((e) => {
    console.error('自测异常:', e);
    failures++;
  })
  .finally(async () => {
    await closePool().catch(() => {});
    process.exit(failures === 0 ? 0 : 1);
  });
