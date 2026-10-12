import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron', '@anthropic-ai/sdk'], sourcemap: true });
await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
await buildRenderer();
