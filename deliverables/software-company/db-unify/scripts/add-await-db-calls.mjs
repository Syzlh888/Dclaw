/**
 * 一次性脚本 (D3)：把所有 route/permissions 文件中对 database.mjs
 * 导出函数的调用前面加上 `await`，并把宿主 handler 改成 async。
 *
 * 匹配的函数（仅当导入自 database.mjs 时才处理）：
 *   getAll, getById, query, insert, update, remove, removeWhere,
 *   getByParentId, getFullTree, reorderSiblings
 *
 * 幂等：已经在 `await` 后面 / `return await` 后面 / `.then(` 前面的调用不会再加。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  'server/routes/access.mjs',
  'server/routes/applications.mjs',
  'server/routes/auth.mjs',
  'server/routes/connections.mjs',
  'server/routes/drivers.mjs',
  'server/routes/engineerings.mjs',
  'server/routes/execute.mjs',
  'server/routes/history.mjs',
  'server/routes/projects.mjs',
  'server/routes/query.mjs',
  'server/routes/roles.mjs',
  'server/routes/scripts.mjs',
  'server/routes/servers.mjs',
  'server/routes/systemConfig.mjs',
  'server/routes/table-mgmt.mjs',
  'server/routes/templates.mjs',
  'server/routes/tree.mjs',
  'server/routes/users.mjs',
  'server/permissions/compute.mjs',
  'server/permissions/init.mjs',
  'server/permissions/sql-analyzer.mjs',
  'server/hgdb-bridge.mjs',
];

// 允许的函数名（要看该文件真正 import 了哪些）
const ALL_FNS = ['getAll', 'getById', 'query', 'insert', 'update', 'remove',
  'removeWhere', 'getByParentId', 'getFullTree', 'reorderSiblings'];

function pickImportedFns(source) {
  const m = source.match(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]*database\.mjs['"]/);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(x => ALL_FNS.includes(x));
}

/**
 * 在 source 里找到所有形如 <fn>(  的调用点，前面加 await。
 * 排除已经在 await/return await/= await 或者 . 之后的（e.g. obj.getAll —— 但我们的都是顶层导入所以 . 前面基本不会命中）
 */
function addAwaits(source, fns) {
  if (fns.length === 0) return source;
  // 建正则：\b(fnA|fnB|...)\s*\(   —— 但需检查前面的字符
  const fnPattern = fns.map(f => f.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
  const re = new RegExp(`(^|[^\\w.$])(${fnPattern})\\s*\\(`, 'g');
  return source.replace(re, (match, pre, name, offset, whole) => {
    // 已经有 await? 检查 pre 及之前
    // 反向扫描：取 offset 处向前的最近若干字符
    // 判断规则：如果紧邻前面的非空白 token 是 'await'，跳过。
    let i = offset + pre.length - 1;
    // 跳过空白（但 pre 已经是单字符，可能是空格/换行/(/,等）
    let backIdx = offset;
    while (backIdx > 0 && /\s/.test(whole[backIdx - 1])) backIdx--;
    // 取前 5 字符
    if (whole.slice(Math.max(0, backIdx - 5), backIdx) === 'await') {
      return match;
    }
    // 如果前面是 `function ` 说明是函数声明本身，跳过（我们的目标是调用）
    // 函数是外部导入的，本地不会有 function getAll() 声明 —— 忽略此case
    return `${pre}await ${name}(`;
  });
}

/**
 * 找到所有 express handler 回调 `(...) => {` / `(...) => ` / function(...){}
 * 检查函数体里是否含 `await ` —— 是的话把函数头变 async。
 * 支持三种写法：
 *   router.method('/x', (req,res) => { ... })
 *   router.method('/x', middleware, (req,res) => { ... })
 *   router.method('/x', function(req,res){ ... })
 */
function asyncifyHandlers(source) {
  let out = source;

  // 1. 箭头函数 (...) => { ... }
  //    在 router.<verb>(  或 middleware,  或 use(  之内出现
  //    简化：全局扫所有 `(<params>) => {` 若函数体包含 `await ` 就在前面加 async
  //    但简化正则难以稳妥抓函数体，改成逐个匹配位置后手动括号计数

  const arrowRe = /(\W)(\([^()]*\))(\s*)=>\s*\{/g;
  out = replaceAsyncByBodyScan(out, arrowRe, (m, pre, params, space) => {
    return `${pre}async ${params}${space}=> {`;
  });

  // 2. function 关键字回调 function(...) { ... } 或 function name(...) { ... }
  const fnRe = /(\W)function(\s+[A-Za-z_$][\w$]*)?(\s*\([^()]*\)\s*)\{/g;
  out = replaceAsyncByBodyScan(out, fnRe, (m, pre, name, sig) => {
    return `${pre}async function${name || ''}${sig}{`;
  });

  return out;
}

/**
 * 通用工具：对每个正则命中，向后括号计数取函数体，若体内含 `await ` 则替换头
 */
function replaceAsyncByBodyScan(source, re, mkReplace) {
  const matches = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    matches.push({ index: m.index, match: m });
  }
  // 从后往前替换，防止 offset 漂移
  for (let i = matches.length - 1; i >= 0; i--) {
    const { index, match } = matches[i];
    const openBraceIdx = index + match[0].length - 1; // 指向 '{'
    const bodyEnd = findMatchingBrace(source, openBraceIdx);
    if (bodyEnd < 0) continue;
    const body = source.slice(openBraceIdx + 1, bodyEnd);
    if (!/\bawait\s/.test(body)) continue;
    // 如果已经是 async 开头 —— 检查 match[1]（pre 字符）之前是否有 async 前缀
    // 简单起见：看 head 里是否已经含 async
    const head = match[0];
    if (/\basync\b/.test(head)) continue;
    // 更严：看 match[1] 前的一小段
    const contextStart = Math.max(0, index - 6);
    const context = source.slice(contextStart, index + match[0].length);
    if (/\basync\s+(function|\()/.test(context)) continue;
    const replaced = mkReplace(...match);
    source = source.slice(0, index) + replaced + source.slice(index + head.length);
  }
  return source;
}

function findMatchingBrace(src, openIdx) {
  if (src[openIdx] !== '{') return -1;
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      // 跳过字符串
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        // 模板字面量里可能嵌 ${...} —— 简化不管
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

let totalTouched = 0;
const changes = [];
for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.warn(`跳过不存在: ${rel}`);
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const fns = pickImportedFns(src);
  if (fns.length === 0) {
    console.log(`- ${rel}: 未导入 database.mjs 目标函数，跳过`);
    continue;
  }
  let out = addAwaits(src, fns);
  out = asyncifyHandlers(out);
  if (out !== src) {
    fs.writeFileSync(abs, out, 'utf8');
    totalTouched++;
    const addedAwaits = (out.match(/\bawait\s+(getAll|getById|query|insert|update|remove(?:Where)?|getByParentId|getFullTree|reorderSiblings)\(/g) || []).length -
                        (src.match(/\bawait\s+(getAll|getById|query|insert|update|remove(?:Where)?|getByParentId|getFullTree|reorderSiblings)\(/g) || []).length;
    const asyncCount = (out.match(/\basync\s+(function|\()/g) || []).length -
                       (src.match(/\basync\s+(function|\()/g) || []).length;
    console.log(`✓ ${rel}: +${addedAwaits} awaits, +${asyncCount} async`);
    changes.push({ rel, addedAwaits, asyncCount });
  } else {
    console.log(`- ${rel}: 无变化`);
  }
}

console.log(`\n完成，触达 ${totalTouched} 个文件`);
