import { execSync } from 'child_process';
try {
  const result = execSync('npx electron-builder --win --x64', {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 600000,
  });
  console.log(result);
} catch (err) {
  console.log('STDOUT:', err.stdout || '');
  console.log('STDERR:', err.stderr || '');
  console.log('EXIT CODE:', err.status);
}
