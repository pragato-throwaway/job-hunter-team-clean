/**
 * Environment-injectable test client.
 *
 * Two modes, one suite:
 *
 *   APP_URL unset  → LocalClient. Boots the Next.js app of `web/` in-process
 *                    (programmatic `next({ dev })` + a plain `http.Server` on
 *                    port 0) with the external dependencies pointed at
 *                    unreachable/throwaway locations: no Supabase project is
 *                    contacted, no `~/.jht` of the developer is touched.
 *
 *   APP_URL set    → RemoteClient. Plain HTTP against the deployed app
 *                    (ALB / Vercel / container), no bootstrap at all.
 *
 * The tests never learn which one they got: they only ever see the
 * `TestClient` interface, and they only ever assert on HTTP status codes and
 * response bodies. That is what makes the same file meaningful both as a
 * development suite and as a deployment smoke test.
 */
import request from 'supertest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TestClient {
  post(path: string): request.Test;
  get(path: string): request.Test;
  patch(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
  close(): Promise<void>;
}

// ── Deployed mode ────────────────────────────────────────────────────────
// hit a real URL over HTTP
class RemoteClient implements TestClient {
  constructor(private baseUrl: string) {}
  post(p: string) {
    return request(this.baseUrl).post(p);
  }
  get(p: string) {
    return request(this.baseUrl).get(p);
  }
  patch(p: string) {
    return request(this.baseUrl).patch(p);
  }
  put(p: string) {
    return request(this.baseUrl).put(p);
  }
  delete(p: string) {
    return request(this.baseUrl).delete(p);
  }
  async close() {}
}

// ── Local mode ───────────────────────────────────────────────────────────
// boot the real app in-process with mocked/neutered dependencies
class LocalClient implements TestClient {
  private server: http.Server | null = null;
  private app: { close?: () => Promise<void> } | null = null;
  private tmpHome: string | null = null;

  async init() {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const webDir = path.join(repoRoot, 'web');

    // 1. Isolate the workspace. `lib/jht-paths.ts` reads JHT_HOME at import
    //    time and every filesystem-backed route hangs off it (jobs.db,
    //    jht.config.json, i18n-prefs.json, .local-token). Pointing it at a
    //    fresh temp dir gives the routes a real, writable, empty workspace:
    //    the "no data yet" branches answer honestly instead of reading — or
    //    worse, writing — the developer's own ~/.jht.
    this.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jht-test-home-'));
    process.env.JHT_HOME = this.tmpHome;
    process.env.JHT_USER_DIR = path.join(this.tmpHome, 'user');
    fs.mkdirSync(process.env.JHT_USER_DIR, { recursive: true });

    // 2. Neutralize Supabase. `lib/supabase/config.ts` falls back to the
    //    project's real public URL when the env is empty, which would make a
    //    local `npm test` depend on that project being up — and would let a
    //    test write into it. A syntactically valid but unroutable URL keeps
    //    `isSupabaseConfigured` true (so the auth path under test is the real
    //    one, 401 included) while every actual query fails fast and locally.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-not-a-secret';

    // 3. Pin the deploy mode. `local` is the container/desktop shape and the
    //    default when the env is absent (see web/lib/deploy-mode.ts); making
    //    it explicit keeps the suite from flipping behaviour just because a
    //    VERCEL env var happens to be exported in the shell.
    process.env.NEXT_PUBLIC_JHT_DEPLOY ??= 'local';
    process.env.NODE_ENV ??= 'test';

    // 4. Boot the app. `next dev` is used rather than a prebuilt `.next`:
    //    the suite has to run on a clean checkout, and requiring `next build`
    //    first would make `npm test` fail for a reason that has nothing to do
    //    with the code under test. Compilation is lazy and per-route, so the
    //    cost lands on the first request to each route, not on startup.
    const nextMod = require(
      path.join(webDir, 'node_modules', 'next', 'dist', 'server', 'next.js'),
    );
    const createServer = nextMod.default ?? nextMod;
    const app = createServer({ dev: true, dir: webDir, quiet: true });
    await app.prepare();
    this.app = app;

    const handler = app.getRequestHandler();
    this.server = http.createServer((req, res) => {
      handler(req, res);
    });

    // Port 0: the OS picks a free port. Nothing in the suite ever names a
    // port — supertest is handed the live server object.
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
  }

  private target(): http.Server {
    if (!this.server) throw new Error('LocalClient.init() was not awaited');
    return this.server;
  }

  post(p: string) {
    return request(this.target()).post(p);
  }
  get(p: string) {
    return request(this.target()).get(p);
  }
  patch(p: string) {
    return request(this.target()).patch(p);
  }
  put(p: string) {
    return request(this.target()).put(p);
  }
  delete(p: string) {
    return request(this.target()).delete(p);
  }

  async close() {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    try {
      await this.app?.close?.();
    } catch {
      /* the dev server is occasionally noisy on teardown; not a test failure */
    }
    this.app = null;
    if (this.tmpHome) {
      fs.rmSync(this.tmpHome, { recursive: true, force: true });
      this.tmpHome = null;
    }
  }
}

export async function createClient(): Promise<TestClient> {
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    console.log(`[test] Running against deployed app: ${appUrl}`);
    return new RemoteClient(appUrl.replace(/\/+$/, ''));
  }
  console.log('[test] Running locally with in-memory mocks');
  const client = new LocalClient();
  await client.init();
  return client;
}

/** Unique-per-run suffix, so nothing collides on a shared/real database. */
export function unique(prefix = 't'): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * True when the suite is pointed at a deployed instance. A handful of
 * assertions legitimately differ between the two worlds — a cloud deploy
 * answers 403 `read_only` where the co-located container answers 200 — and
 * this lets a test accept both shapes without going blind to either.
 */
export const isRemote = Boolean(process.env.APP_URL);
