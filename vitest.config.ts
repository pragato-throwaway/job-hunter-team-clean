import { defineConfig } from 'vitest/config';

// Root suite: the environment-injectable HTTP tests in `tests/*.spec.ts`.
//
// `include` is deliberately narrow. `tests/` also holds the Python suite and
// `tests/js/`, which has its own vitest project (own config, own aliases, own
// grammy mocks) — sweeping those in from here would run them twice under the
// wrong resolver. See `npm run test:js` / `test:py` for those.
export default defineConfig({
  test: {
    include: ['tests/*.spec.ts'],
    exclude: ['**/node_modules/**', 'tests/js/**', 'e2e/**'],
    // Booting Next.js once per file is the expensive part; running the files
    // sequentially in a single worker means one boot for the whole suite
    // instead of one per parallel worker.
    fileParallelism: false,
    // First-request-per-route compilation in dev mode is slow on a cold
    // checkout, and a deployed target adds real network latency on top.
    testTimeout: 120_000,
    hookTimeout: 240_000,
    teardownTimeout: 30_000,
  },
});
