import { build } from 'electron-builder';

try {
  await build({
    config: {
      appId: 'com.dclaw.db-unify',
      productName: 'DB-Unify',
      directories: { output: 'release', buildResources: 'build' },
      files: ['dist/**/*', 'server/**/*', '.env', 'package.json', 'node_modules/**/*'],
      win: { target: [{ target: 'dir', arch: ['x64'] }] },
      extraResources: [{ from: 'server', to: 'server' }],
      electronDownload: { mirror: 'https://npmmirror.com/mirrors/electron/' },
    },
  });
  console.log('BUILD SUCCESS');
} catch (err) {
  console.error('BUILD FAILED:', err.message);
  console.error(err.stack);
}
