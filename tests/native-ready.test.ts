import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeReadiness } from '../src/services/nativeReady';
test('Android readiness retries lost read-only IPC and shares one startup probe', async () => {
  let calls = 0;
  const ready = nativeReadiness(() => ++calls === 1 ? new Promise(() => {}) : Promise.resolve(1), 5, 3);
  await Promise.all([ready(), ready(), ready()]);
  assert.equal(calls, 2);
  await ready(); assert.equal(calls, 2);
});
test('failed readiness is bounded and a user retry can recover', async () => {
  let working = false;
  const ready = nativeReadiness(() => working ? Promise.resolve(1) : Promise.reject(Error('unavailable')), 5, 2);
  await assert.rejects(ready(), /Could not initialize local storage/);
  working = true;
  await ready();
});
