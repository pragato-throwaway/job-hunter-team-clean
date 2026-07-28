import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type TestClient } from './utils/client';

describe('Health and liveness', () => {
  let client: TestClient;

  beforeAll(async () => {
    client = await createClient();
  });
  afterAll(async () => {
    await client.close();
  });

  it('GET /api/health returns 200 with an ok flag and a timestamp', async () => {
    const res = await client.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    // `ts` is Date.now() on the server: assert the type, not the value —
    // clocks differ between the test host and a deployed instance.
    expect(typeof res.body.ts).toBe('number');
    expect(res.body.ts).toBeGreaterThan(0);
  });

  it('GET /api/health is a cheap probe: no auth, no cookies required', async () => {
    // The desktop launcher polls this to decide when the runtime is up, so it
    // has to answer before any session exists. Sending no credentials at all
    // must still be a 200.
    const res = await client.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/about reports the project identity and stats', async () => {
    const res = await client.get('/api/about');

    expect(res.status).toBe(200);
    expect(typeof res.body.name).toBe('string');
    expect(res.body.name.length).toBeGreaterThan(0);
    // Semver-ish, but not a literal: the version moves with every release.
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.body.stats).toBeTypeOf('object');
    expect(typeof res.body.stats.apiRoutes).toBe('number');
    expect(Array.isArray(res.body.modules)).toBe(true);
    expect(res.body.stack).toBeTypeOf('object');
  });

  it('GET /api/canary reports both probes and an interpretation', async () => {
    // A report, not a controller: it answers 200 even when Supabase is down
    // (locally it always is — the client points at an unroutable port). The
    // contract under test is the shape oncall reads, not the verdict.
    const res = await client.get('/api/canary');

    expect(res.status).toBe(200);
    expect(res.body.supabase).toBeTypeOf('object');
    expect(typeof res.body.supabase.status).toBe('string');
    expect(typeof res.body.supabase.latency_ms).toBe('number');
    expect(res.body.vercel).toBeTypeOf('object');
    expect(typeof res.body.vercel.process_ms).toBe('number');
    expect(typeof res.body.interpretation).toBe('string');
    expect(res.body.interpretation.length).toBeGreaterThan(0);
    expect(new Date(res.body.ts).toString()).not.toBe('Invalid Date');
  });

  it('GET /api/local/health reports workspace and session state as booleans', async () => {
    const res = await client.get('/api/local/health');

    expect(res.status).toBe(200);
    expect(typeof res.body.local).toBe('boolean');
    expect(typeof res.body.logged_in).toBe('boolean');
    // Unauthenticated caller: the identity fields must be absent, not guessed.
    expect(res.body.logged_in).toBe(false);
    expect(res.body.user_email).toBeNull();
    expect(res.body.user_id).toBeNull();
  });
});
