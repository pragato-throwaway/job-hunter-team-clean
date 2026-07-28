import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type TestClient } from './utils/client';

/**
 * The auth contract of the API surface.
 *
 * There is no signup/login endpoint to exercise here: identity is delegated to
 * Supabase (hosted GoTrue) and the app only ever *verifies* a session. What
 * this app owns — and what therefore has to be tested — is the guard: which
 * routes are deliberately public, which demand a session, and what an
 * unauthenticated caller gets back. That guard is `requireAuth` in
 * `web/lib/auth.ts`, and it is the thing standing between an exposed
 * deployment and the user's CV, secrets and provider keys.
 */
describe('Authentication and route guards', () => {
  let client: TestClient;

  beforeAll(async () => {
    client = await createClient();
  });
  afterAll(async () => {
    await client.close();
  });

  // Routes that must stay reachable without a session. Each one has a reason
  // it is public, and that reason is a product requirement: the landing page
  // and the smoke checks have no user yet.
  const publicRoutes = [
    '/api/health',
    '/api/about',
    '/api/i18n',
    '/api/canary',
  ];

  it.each(publicRoutes)(
    'GET %s is public and answers without credentials',
    async (route) => {
      const res = await client.get(route);

      expect(res.status).toBe(200);
      expect(res.body).toBeTypeOf('object');
    },
  );

  // Routes behind `requireAuth`. These read or act on user-owned material:
  // stored secrets, provider credentials, the agent team, the message log.
  const protectedRoutes = [
    '/api/secrets',
    '/api/credentials',
    '/api/providers',
    '/api/agents',
    '/api/messages',
    '/api/notifications',
    '/api/cron',
    '/api/backup',
    '/api/export',
    '/api/workspace',
  ];

  it.each(protectedRoutes)(
    'GET %s rejects an anonymous caller with 401',
    async (route) => {
      const res = await client.get(route);

      expect(res.status).toBe(401);
      // The refusal must carry an error and nothing else: no partial payload
      // leaking the shape or size of what is being protected.
      expect(res.body.error).toBeTruthy();
      expect(res.body).not.toHaveProperty('secrets');
      expect(res.body).not.toHaveProperty('credentials');
      expect(res.body).not.toHaveProperty('config');
    },
  );

  it('a forged bearer token does not open a protected route', async () => {
    // `lib/local-token.ts` accepts `Authorization: Bearer <64 hex>` as a local
    // auth path. A well-formed but wrong token must fail the constant-time
    // comparison — the format being right is not the same as the value being
    // right.
    const forged = 'a'.repeat(64);
    const res = await client
      .get('/api/secrets')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('a malformed Authorization header does not open a protected route', async () => {
    const res = await client
      .get('/api/credentials')
      .set('Authorization', 'Bearer not-a-hex-token');

    expect(res.status).toBe(401);
  });

  it('a spoofed Host header does not grant local privileges', async () => {
    // Finding C1: `Host`/`X-Forwarded-Host` are client-controlled, so "the
    // host looks like localhost" was removed as an auth bypass. A remote
    // caller claiming to be localhost must still be refused.
    const res = await client
      .get('/api/secrets')
      .set('Host', 'localhost')
      .set('X-Forwarded-Host', 'localhost')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.status).toBe(401);
  });

  it('GET /api/profile does not return profile data to an anonymous caller', async () => {
    // This endpoint serves name, email, phone and work history. Its two lanes
    // (cloud session vs local workspace) answer with different status codes,
    // so the assertion is on the invariant that matters: no profile leaks.
    const res = await client.get('/api/profile');

    expect([200, 401]).toContain(res.status);
    expect(res.body.profile ?? null).toBeNull();
    expect(res.body.ready).toBeFalsy();
  });
});
