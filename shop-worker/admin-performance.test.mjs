import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminRequest } from './admin-api.js';
import { allMigrations, sqliteD1 } from './test-d1.mjs';

test('overview and orders respond while PayPal is stalled; authorization is still required', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  try {
    for (const route of ['overview', 'orders']) {
      const DB = sqliteD1(allMigrations());
      const env = {DB, ADMIN_TOKEN:'test', PAYPAL_CLIENT_ID:'test', PAYPAL_CLIENT_SECRET:'test'};
      const url = new URL('https://api.disorder119.com/admin/' + route);
      const tasks = [];
      const ctx = {waitUntil(promise){tasks.push(promise);}};
      const unauthorized = await handleAdminRequest(new Request(url), env, url, 'test', null, ctx);
      assert.equal(unauthorized.status, 401);
      assert.equal(tasks.length, 0);
      let timer;
      const response = await Promise.race([
        handleAdminRequest(new Request(url, {headers:{Authorization:'Bearer test'}}), env, url, 'test', null, ctx),
        new Promise((_, reject) => {timer=setTimeout(()=>reject(new Error('reading waited for provider')),1000);}),
      ]).finally(()=>clearTimeout(timer));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).paypalRefundSync.pending, true);
      assert.equal(tasks.length, 1);
      assert.match(response.headers.get('Cache-Control'), /no-store/);
    }
  } finally {globalThis.fetch=original;}
});
