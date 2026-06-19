import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
console.log('Setting DATA_DIR to:', dataDir);
console.log('File exists:', fs.existsSync(join(dataDir, 'connections.json')));
process.env.DATA_DIR = dataDir;

function toUrl(p) { return pathToFileURL(p).href; }
const { getAll } = await import(toUrl(join(__dirname, 'server/database.mjs')));
const conns = getAll('connections');
console.log('Connections loaded:', conns.length);
if (conns.length > 0) {
  const online = conns.find(c => c.status === 'online');
  console.log('Online conn:', online?.id, online?.name);
}
