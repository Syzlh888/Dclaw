/**
 * 临时测试脚本：复现 execute 接口崩溃
 */
const connId = '6-chqhrA'; // 市直

try {
  // 1. 获取连接信息
  const connResp = await fetch('http://localhost:3001/api/connections');
  const connData = await connResp.json();
  const conn = connData.connections.find(c => c.id === connId);
  console.log('[1] 连接:', conn?.name, '| driver:', conn?.driver, '| custom:', conn?.custom_driver_id);

  // 2. 执行 SQL
  console.log('[2] 发送执行请求...');
  const execResp = await fetch('http://localhost:3001/api/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sql: 'select version()',
      connectionIds: [connId],
      config: { timeoutMs: 20000 }
    }),
  });
  console.log('[2] Status:', execResp.status);

  if (!execResp.ok) {
    const errText = await execResp.text();
    console.log('[2] Error:', errText.substring(0, 500));
    process.exit(1);
  }

  // 3. 读取 SSE 流
  console.log('[3] 读取 SSE 流...');
  const reader = execResp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[3] Stream done (normal close)');
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      buf += chunk;

      // 打印每个事件
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) {
          console.log('  EVENT:', line.trim());
        } else if (line.startsWith('data:')) {
          const dataStr = line.trim().substring(5);
          try {
            const data = JSON.parse(dataStr);
            console.log('  DATA:', JSON.stringify(data).substring(0, 200));
          } catch {
            console.log('  DATA (raw):', dataStr.substring(0, 100));
          }
        }
      }

      if (buf.includes('"complete"') || buf.includes('"error"')) {
        console.log('[3] 收到终态事件，退出读取');
        break;
      }

      // 防止无限等
      if (buf.length > 50000) {
        console.log('[3] 数据过大，停止');
        break;
      }
    }
  } catch (readErr) {
    console.error('[3] Read error:', readErr.message, '| buffer size:', buf.length);
    console.error('[3] 已收到的数据:');
    console.log(buf.substring(0, 1000));
  }

  // 4. 检查后端是否还活着
  console.log('[4] 检查后端状态...');
  try {
    const health = await fetch('http://localhost:3001/api/health');
    const hdata = await health.json();
    console.log('[4] 后端正常 | uptime:', Math.round(hdata.uptime), 's');
  } catch {
    console.log('[4] 后端已死！');
  }

} catch (e) {
  console.error('Fatal:', e.message, e.stack);
}
