import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker-entry.js';
import { finalizeRuntimeResponse } from './backend-runtime.js';

test('public health reveals no configuration and does not touch storage or providers', async () => {
  const env = { PAYPAL_ENVIRONMENT: 'live', PAYPAL_CLIENT_ID: 'synthetic-public-id',
    PAYPAL_CLIENT_SECRET: 'synthetic-secret', PAYPAL_WEBHOOK_ID: 'synthetic-webhook',
    ADMIN_READ_TOKEN: 'synthetic-reader', ADMIN_WRITE_TOKEN: 'synthetic-owner',
    DB: { prepare() { throw new Error('public health read storage'); } } };
  const response = await worker.fetch(new Request('https://api.disorder119.com/health'), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('private diagnostics enrich only successful authenticated system responses', async () => {
  const request = new Request('https://api.disorder119.com/admin/system');
  const env = { PAYPAL_ENVIRONMENT: 'live', ADMIN_READ_TOKEN: 'synthetic-reader', ADMIN_WRITE_TOKEN: 'synthetic-owner' };
  const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const privateResult = await finalizeRuntimeResponse(response({ schema: 'test' }), request, env, 'synthetic-request', '/admin/system');
  const body = await privateResult.json();
  assert.equal(body.backendHardening.adminRbacReady, true);
  assert.equal(body.backendHardening.environment, 'live');
  assert.doesNotMatch(JSON.stringify(body), /synthetic-reader|synthetic-owner/);
  const denied = await worker.fetch(request, env, {});
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).backendHardening, undefined);
  const publicResult = await finalizeRuntimeResponse(response({ ok: true }), request, env, 'synthetic-request', '/health');
  assert.deepEqual(await publicResult.json(), { ok: true });
});
