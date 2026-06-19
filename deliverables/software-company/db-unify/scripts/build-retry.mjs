import { build } from 'electron-builder';

let retries = 3;
while (retries > 0) {
  try {
    await build({
      config: {
        appId: 'com.dclaw.db-unify',
        productName: 'DB-Unify',
        directories: { output: '../release-out', buildResources: 'build' },
        files: ['dist/**/*', 'server/**/*', '.env', 'package.json', 'node_modules/**/*'],
        win: { target: [{ target: 'nsis', arch: ['x64'] }] },
        nsis: {
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
        },
        extraResources: [{ from: 'server', to: 'server' }],
        electronDownload: { mirror: 'https://npmmirror.com/mirrors/electron/' },
      },
    });
    console.log('BUILD SUCCESS!');
    process.exit(0);
  } catch (err) {
    console.error(`Attempt failed (${retries} retries left):`, err.message);
    retries--;
    if (retries === 0) {
      console.error('BUILD FAILED after all retries');
      process.exit(1);
    }
    // Wait 3 seconds before retry
    await new Promise(r => setTimeout(r, 3000));
  }
}
