#!/usr/bin/env node
/**
 * 归档 data/ 到 data.snapshots/pre-pg-migration-YYYYMMDD-HHMMSS.tgz
 * 便于 JSON → PG 迁移前留一份可回滚的快照。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SNAP_DIR = path.join(ROOT, 'data.snapshots');

function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`❌ data 目录不存在: ${DATA_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(SNAP_DIR, { recursive: true });

  const outName = `pre-pg-migration-${ts()}.tgz`;
  const outFile = path.join(SNAP_DIR, outName);
  console.log(`📦 归档 data/ → ${path.relative(ROOT, outFile)}`);

  // tar 存在(git-bash / macOS / linux 都自带)
  // 关键: git-bash 的 tar 不理解 Windows 绝对路径, 所以我们 cd 到 ROOT, 用相对路径
  const relOut = path.posix.join('data.snapshots', outName);
  const r = spawnSync('tar', ['-czf', relOut, 'data'], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) {
    console.error('❌ tar 归档失败');
    process.exit(r.status || 1);
  }

  const size = fs.statSync(outFile).size;
  console.log(`✅ 完成, 大小 ${(size / 1024).toFixed(1)} KB`);
}

main();
