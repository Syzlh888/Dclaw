/**
 * 手动打包脚本 - 绕过 electron-builder 的 EBUSY 问题
 * 输出免安装版到 release/DB-Unify-Portable/
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const outDir = join(rootDir, 'release', 'DB-Unify-Portable');
const cacheDir = process.env.LOCALAPPDATA + '/electron-builder/Cache/electron';
const electronZip = join(cacheDir, 'electron-v42.3.3-win32-x64.zip');
const electron7z = join(cacheDir, 'electron', 'electron-v42.3.3-win32-x64.7z');

// Step 1: Extract electron
console.log('Step 1: Extracting Electron...');
if (!existsSync(electronZip)) {
  console.error('Electron zip not found at', electronZip);
  process.exit(1);
}

// Clean output
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Extract electron zip using built-in Windows tar (Win10 1803+)
execSync(`tar -xf "${electronZip}" -C "${outDir}"`, { stdio: 'inherit' });

// Step 2: Copy our app into resources
console.log('Step 2: Copying app files...');
const resourcesDir = join(outDir, 'resources');
const appDir = join(resourcesDir, 'app');
mkdirSync(appDir, { recursive: true });

// Copy necessary files
const filesToCopy = ['dist', 'server', 'electron', 'node_modules', 'package.json'];
for (const f of filesToCopy) {
  const src = join(rootDir, f);
  const dest = join(appDir, f);
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
    console.log(`  ✓ ${f}`);
  }
}

// Copy .env if exists
const envSrc = join(rootDir, '.env');
if (existsSync(envSrc)) {
  cpSync(envSrc, join(appDir, '.env'));
  console.log('  ✓ .env');
}

console.log(`\n✅ Portable build complete!`);
console.log(`   Location: ${outDir}`);
console.log(`   Run: ${join(outDir, 'DB-Unify.exe')}`);
