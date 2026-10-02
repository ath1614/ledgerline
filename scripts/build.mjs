import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
process.chdir(root);

await rm('deploy', { recursive: true, force: true });
await mkdir('deploy/public', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'deploy/index.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  conditions: ['workerd', 'worker', 'browser'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

await cp('dist', 'deploy/public', { recursive: true });

const manifest = {
  entrypoint: 'index.js',
  compatibilityDate: '2026-10-01',
  modules: [{ name: 'index.js', type: 'esm', path: './index.js' }],
  assetsDirectory: './public',
  spa: true,
};

await writeFile('deploy/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log('deploy/ ready');
