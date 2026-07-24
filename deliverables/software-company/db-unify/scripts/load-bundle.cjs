// CJS loader for esbuild server bundle
// Sets up globalThis.require so dynamic require() calls in the bundle work
const { createRequire } = require('module');
const path = require('path');

// In CJS, __dirname and __filename are always available
const req = createRequire(__filename);
globalThis.require = req;

// Load the bundled server code
require('./server-bundle.cjs');
