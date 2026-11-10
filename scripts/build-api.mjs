// Vercel build step: bundle each api/*.ts function into one self-contained
// file so the zero-config function builder never sees extensionless ESM
// imports (Node requires explicit extensions at runtime; Vite/Vitest hide
// this locally). No-op outside Vercel builds.
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.VERCEL) {
  console.log('build-api: not a Vercel build, skipping');
  process.exit(0);
}

const entries = [
  'api/index.ts',
  'api/auth/status.ts',
  'api/auth/logout.ts',
  'api/auth/github/index.ts',
  'api/auth/github/callback.ts',
];

const outDir = resolve('.vercel-api-tmp');
for (const entry of entries) {
  await build({
    logLevel: 'silent',
    build: {
      ssr: resolve(entry),
      outDir,
      emptyOutDir: false,
      minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'bundle.mjs' } },
    },
    ssr: { noExternal: true },
  });
  writeFileSync(resolve(entry), readFileSync(resolve(outDir, 'bundle.mjs'), 'utf8'));
}
rmSync(outDir, { recursive: true, force: true });
console.log('build-api: bundled ' + entries.length + ' functions');
