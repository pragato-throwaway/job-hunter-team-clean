# Testing Guide

This repository uses an **environment-injectable test architecture**. The same test suite runs in two modes:

1. **Local mode** — boots the app in-process with mocked dependencies (no external services needed)
2. **Deployed mode** — hits a real deployed instance over HTTP (real database, real network)

## Quick Start

### Local mode (mocked)

```bash
npm install
npm test
```

This will:
- Bootstrap the app with in-memory/mocked dependencies
- Run all tests against the local server
- Tear down everything on completion

No environment variables, databases, or external services required.

### Deployed mode (against a live deployment)

```bash
APP_URL=https://your-deployed-url.com npm test
```

This will:
- Skip local app bootstrap entirely
- Send real HTTP requests to the URL specified in `APP_URL`
- Test against whatever database and services are behind that URL

Use this after deploying the app to AWS to verify the deployment works end-to-end.

## Architecture

### `tests/utils/client.ts`

The core abstraction. Exports `createClient()` which returns a `TestClient` interface:

- If `APP_URL` is set → returns a `RemoteClient` (HTTP requests to that URL)
- If `APP_URL` is not set → returns a `LocalClient` (boots app in-process with mocked deps)

### Test strategy

Category: **supabase**
Test type: API/integration tests (endpoints return expected shapes, auth works, CRUD operations succeed)

### Test design principles

1. **No internal state assertions** — tests only check HTTP response status codes and body shapes
2. **Unique test data** — identifiers include timestamps/random suffixes to avoid collisions on real databases
3. **No hardcoded URLs** — all requests go through TestClient
4. **Self-contained** — each test creates its own data, never depends on pre-seeded state

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_URL` | No | If set, tests run in deployed mode against this URL. If unset, tests run locally with mocks. |

## Running Against AWS Deployment

After deploying this app to AWS (e.g., ECS Fargate + RDS/DocumentDB + ALB):

```bash
export APP_URL=http://my-alb-123456.us-east-1.elb.amazonaws.com
npm test
```

## Adding New Tests

Follow the existing pattern:

```typescript
import { createClient, TestClient } from './utils/client';

describe('My feature', () => {
  let client: TestClient;

  beforeAll(async () => { client = await createClient(); });
  afterAll(async () => { await client.close(); });

  it('does something', async () => {
    const res = await client.get('/api/my-endpoint');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('expectedField');
  });
});
```

Rules:
- Always use `createClient()` — never use supertest/fetch directly against a hardcoded URL
- Use unique identifiers in test data (`Date.now()`, `crypto.randomUUID()`)
- Assert on response shapes, not exact values that might differ between environments
- Call `client.close()` in `afterAll` to clean up resources
