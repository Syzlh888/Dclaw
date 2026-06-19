/**
 * 通过 HTTP API 测试 execute，使用 postgresql 连接（非 JDBC）
 */
const baseUrl = 'http://localhost:3001';

// 1. 获取连接列表
console.log('[1] Getting connections...');
const connResp = await fetch(baseUrl + '/api/connections');
const connData = await connResp.json();
const conns = connData.connections;
console.log('Total:', conns.length);

// 2. 找一个 postgresql 类型的连接
const pgConn = conns.find(c => c.driver === 'postgresql');
if (!pgConn) {
  console.log('No postgresql conn, using first:', conns[0]?.id, conns[0]?.name);
}
const target = pgConn || conns[0];
console.log('[2] Testing with:', target?.id, target?.name, '| driver:', target?.driver);

// 3. 执行 SQL
console.log('[3] Sending execute request...');
try {
  const execResp = await fetch(baseUrl + '/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: 'select version()',
      connectionIds: [target.id],
      config: { timeoutMs: 10000 }
    })
  });
  console.log('[3] Status:', execResp.status);

  const reader = execResp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { console.log('[4] Stream done'); break; }
      buf += dec.decode(value, { stream: true });
    }
    console.log('[4] Received:', buf.substring(0, 500));
  } catch (readErr) {
    console.error('[4] Read error:', readErr.message, '| buf size:', buf.length);
    console.error('[4] Buffer:', buf.substring(0, 500));
  }
} catch (fetchErr) {
  console.error('[3] Fetch error:', fetchErr.message);
}

// 4. 检查后端状态
await new Promise(r => setTimeout(r, 1000));
try {
  const h = await fetch(baseUrl + '/api/health');
  const d = await h.json();
  console.log('[5] Backend alive | uptime:', Math.round(d.uptime), 's');
} catch {
  console.log('[5] Backend DEAD!');
}
