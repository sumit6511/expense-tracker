// Bundles the API and worker for production. Our own code and the workspace package
// (@et/shared, TypeScript source) are bundled; npm dependencies stay external and are installed
// normally, which keeps native modules (argon2) and pino transports working.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@et/'));

await build({
  entryPoints: {
    server: 'src/index.ts',
    worker: 'src/worker.ts',
    migrate: 'src/db/migrate-cli.ts',
    seed: 'src/db/seed-cli.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, ...external.map((name) => `${name}/*`)],
  banner: {
    // Some CommonJS dependencies expect `require` to exist in ESM output.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
