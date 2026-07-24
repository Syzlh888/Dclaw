/**
 * 修复 `await fn(...).method(...)` → `(await fn(...)).method(...)`
 * 因为 await 优先级低于成员访问，前者会对 Promise 调 .method 报错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FNS = ['getAll', 'getById', 'query', 'insert', 'update', 'remove',
  'removeWhere', 'getByParentId', 'getFullTree', 'reorderSiblings'];

const TARGETS = fs.readdirSync(path.join(ROOT, 'server/routes'))
  .filter(f => f.endsWith('.mjs'))
  .map(f => `server/routes/${f}`)
  .concat([
    'server/permissions/compute.mjs',
    'server/permissions/init.mjs',
    'server/hgdb-bridge.mjs',
  ]);

function findCallEnd(src, openParenIdx) {
  // openParenIdx 指向 '('
  let depth = 1;
  for (let i = openParenIdx + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        // 模板串嵌套 —— 简化不管
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const fnPattern = FNS.join('|');
const re = new RegExp(`\\bawait\\s+(${fnPattern})\\s*\\(`, 'g');

let total = 0;
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  let src = fs.readFileSync(abs, 'utf8');
  const positions = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = findCallEnd(src, openParen);
    if (closeParen < 0) continue;
    // 看闭括号后紧跟 .method / .field / ?.method
    let j = closeParen + 1;
    if (src[j] === '.' || (src[j] === '?' && src[j + 1] === '.')) {
      positions.push({ start: m.index, end: closeParen });
    }
  }
  if (positions.length === 0) continue;
  // 从后往前替换
  for (let i = positions.length - 1; i >= 0; i--) {
    const { start, end } = positions[i];
    // start 指向 'await'
    const callEnd = end + 1; // exclusive
    const inner = src.slice(start + 6, callEnd); // 去掉 'await '
    // 检查前面是否已经有额外的 '(' —— 简单跳过（用 include 检测）
    const before = src.slice(Math.max(0, start - 1), start);
    if (before === '(') continue; // 已经被人手工加过
    const replaced = `(await ${inner})`;
    src = src.slice(0, start) + replaced + src.slice(callEnd);
  }
  fs.writeFileSync(abs, src, 'utf8');
  console.log(`✓ ${rel}: 修复 ${positions.length} 处`);
  total += positions.length;
}
console.log(`\n共修复 ${total} 处`);
