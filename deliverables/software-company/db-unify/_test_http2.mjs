/**
 * 通过 HTTP API 测试 execute，使用 custom/JDBC 连接（"市直"）
 */
const baseUrl = 'http://localhost:3001';

// 获取连接列表
const connResp = await fetch(baseUrl + '/api/connections');
const connData = await connResp.json();
const conns = connData.connections;

// 找 custom driver 且 online 的连接
const customConn = conns.find(c => c.driver === 'custom' && c.status === 'online')
  || conns.find(c => c.driver === 'custom');

if (!customConn) { console.log('No custom connection!'); process.exit(1); }

console.log('[1] Testing custom conn:', customConn.id, customConn.name, '| status:', customConn.status);

// 执行 SQL
console.log('[2] Sending execute...');
const execResp = await fetch(baseUrl + '/api/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sql: 'select version()',
    connectionIds: [customConn.id],
    config: { timeoutMs: 15000 }
  })
});
console.log('[2] Status:', execResp.status);

// 读取响应
const reader = execResp.body.getReader();
const dec = new TextDecoder();
let buf = '';
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) { console.log('[3] Stream done normally'); break; }
    buf += dec.decode(value, { stream: true });
  }
  console.log('[3] Data received (' + buf.length + ' bytes):');
  console.log(buf.substring(0, 800));
} catch (readErr) {
  console.error('[3] Read error:', readErr.message, '| buf:', buf.length, 'bytes');
}

// 检查后端
await new Promise(r => setTimeout(r, 1000));
try {
  const h = await fetch(baseUrl + '/api/health');
  const d = await h.json();
  console.log('[4] Backend ALIVE | uptime:', Math.round(d.uptime), 's');
} catch {
  console.log('[4] Backend DEAD!');
}
