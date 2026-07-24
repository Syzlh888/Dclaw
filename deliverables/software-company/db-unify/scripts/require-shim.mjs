// esbuild require shim — injects globalThis.require for ESM builds
// This covers esbuild's __require() fallback which checks global require
import { createRequire } from 'node:module';
const __req = createRequire(import.meta.url);
globalThis.require = __req;
