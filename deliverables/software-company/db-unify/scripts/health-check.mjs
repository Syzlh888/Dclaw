/**
 * DClaw 自动化API健康检查
 * 在主机上运行：node scripts/health-check.mjs
 */
const BASE = 'http://localhost:8081';

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || '断言失败');
}

async function main() {
  console.log('\n🔍 DClaw 自动化 API 健康检查\n');

  // 1. 服务器健康
  await test('服务器健康检查', async () => {
    const r = await fetch(`${BASE}/api/health`);
    const d = await r.json();
    assert(r.ok, `状态码 ${r.status}`);
    assert(d.status === 'ok', `status=${d.status}`);
  });

  // 2. 登录
  let token = '';
  await test('用户登录', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const d = await r.json();
    assert(r.ok, `状态码 ${r.status}`);
    assert(!!d.token, '无 token');
    assert(d.user.username === 'admin', `用户名=${d.user.username}`);
    token = d.token;
  });

  // 3. 树 API (需认证)
  await test('树数据加载', async () => {
    const r = await fetch(`${BASE}/api/tree`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    assert(r.ok, `状态码 ${r.status}`);
    const nodes = d.nodes || {};
    const roots = d.rootNodeIds || [];
    assert(roots.length > 0, `无根节点, nodes=${Object.keys(nodes).length}`);
    console.log(`     节点数: ${Object.keys(nodes).length}, 根: ${roots.length}`);
  });

  // 4. 连接管理
  await test('连接列表', async () => {
    const r = await fetch(`${BASE}/api/connections`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r.ok, `状态码 ${r.status}`);
    const d = await r.json();
    const count = d.connections?.length || d.length || 0;
    console.log(`     连接数: ${count}`);
  });

  // 5. 驱动列表
  await test('驱动管理', async () => {
    const r = await fetch(`${BASE}/api/drivers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r.ok, `状态码 ${r.status}`);
    const d = await r.json();
    const count = d.drivers?.length || d.length || 0;
    assert(count > 0, `驱动数=${count}`);
    console.log(`     驱动数: ${count}`);
  });

  // 6. 服务器资源
  await test('服务器资源列表', async () => {
    const r = await fetch(`${BASE}/api/servers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r.ok, `状态码 ${r.status}`);
    const d = await r.json();
    const count = d.servers?.length || d.length || 0;
    console.log(`     服务器数: ${count}`);
  });

  // 7. 用户管理
  await test('用户列表', async () => {
    const r = await fetch(`${BASE}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r.ok, `状态码 ${r.status}`);
    const d = await r.json();
    const count = d.users?.length || d.length || 0;
    console.log(`     用户数: ${count}`);
  });

  // 8. 备份配置
  await test('备份配置', async () => {
    const r = await fetch(`${BASE}/api/backup/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r.ok, `状态码 ${r.status}`);
  });

  // 9. 认证拦截（未登录访问应返回401）
  await test('未登录拦截', async () => {
    const r = await fetch(`${BASE}/api/tree`);
    assert(r.status === 401, `应返回401, 实际=${r.status}`);
  });

  // 10. 登录状态自检
  await test('登录状态持久化', async () => {
    // 用 token 连续请求两次验证 token 有效
    const r1 = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r1.ok, `第一次请求 ${r1.status}`);
    const r2 = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(r2.ok, `第二次请求 ${r2.status}`);
    const d1 = await r1.json();
    assert(d1.user?.username === 'admin', `用户=${d1.user?.username}`);
  });

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n💥 执行异常:', e.message);
  process.exit(1);
});
