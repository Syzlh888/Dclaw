/**
 * 超轻量测试：用 curl 直接调 API，看后端终端输出
 * 同时在后端 _trace.log 看执行到了哪一步
 */
import { writeFileSync } from 'node:fs';
const LOG = 'data/_trace.log';

// 清空旧日志
try { writeFileSync(LOG, ''); } catch {}

// 用原生 http 模块发请求（避免 fetch 的问题）
import http from 'node:http';

const req = http.request({
  hostname: 'localhost', port: 3001,
  path: '/api/execute', method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, (res) => {
  console.log('Response status:', res.statusCode);
  const chunks = [];
  res.on('data', d => { chunks.push(d); process.stdout.write(`[got ${d.length} bytes] `); });
  res.on('end', () => { 
    const buf = Buffer.concat(chunks).toString();
    console.log('\nTotal:', buf.length, 'bytes');
    console.log(buf.substring(0, 500));
    checkBackend();
  });
  res.on('error', e => { console.error('Res error:', e.message); checkBackend(); });
  res.on('close', () => { console.log('Response closed'); });
});

req.on('error', e => console.error('Req error:', e.message));
req.write(JSON.stringify({
  sql: 'select version()',
  connectionIds: ['6-chqhrA'],
  config: { timeoutMs: 15000 }
}));
req.end();

function checkBackend() {
  setTimeout(() => {
    http.get('http://localhost:3001/api/health', (r) => {
      let b = '';
      r.on('data', d => b += d);
      r.on('end', () => {
        const j = JSON.parse(b);
        console.log('Backend:', j.status, '| uptime:', Math.round(j.uptime), 's');
      });
    }).on('error', () => console.log('Backend dead'));
  }, 1000);
}
