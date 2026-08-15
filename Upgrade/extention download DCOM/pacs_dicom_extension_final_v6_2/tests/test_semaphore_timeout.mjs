import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncSemaphore, sleepAbortable } from '../lib/semaphore.js';

test('Semaphore acquires up to limit and blocks further', async () => {
  const sem = new AsyncSemaphore(3);
  await sem.acquire();
  await sem.acquire();
  await sem.acquire();
  assert.equal(sem.active, 3);

  let fourthResolved = false;
  const p4 = sem.acquire().then(() => { fourthResolved = true; });
  assert.equal(fourthResolved, false);
  assert.equal(sem.waiters.length, 1);

  sem.release();
  await p4;
  assert.equal(fourthResolved, true);
  assert.equal(sem.active, 3);
  assert.equal(sem.waiters.length, 0);

  sem.release();
  sem.release();
  sem.release();
  assert.equal(sem.active, 0);
});

test('Semaphore rejects immediately if signal already aborted', async () => {
  const sem = new AsyncSemaphore(3);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(async () => {
    await sem.acquire(controller.signal);
  }, { name: 'AbortError' });

  assert.equal(sem.active, 0);
  assert.equal(sem.waiters.length, 0);
});

test('Semaphore waiter in queue cancels cleanly when signal aborts', async () => {
  const sem = new AsyncSemaphore(2);
  await sem.acquire();
  await sem.acquire();
  assert.equal(sem.active, 2);

  const controller = new AbortController();
  const p3 = sem.acquire(controller.signal);
  assert.equal(sem.waiters.length, 1);

  controller.abort();
  await assert.rejects(async () => {
    await p3;
  }, { name: 'AbortError' });

  assert.equal(sem.waiters.length, 0);
  assert.equal(sem.active, 2);

  // Releasing permit allows next valid waiter to enter
  let p4Resolved = false;
  const p4 = sem.acquire().then(() => { p4Resolved = true; });
  assert.equal(sem.waiters.length, 1);
  sem.release();
  await p4;
  assert.equal(p4Resolved, true);
  assert.equal(sem.active, 2);

  sem.release();
  sem.release();
  assert.equal(sem.active, 0);
});

test('sleepAbortable resolves on timeout and cancels on abort', async () => {
  const start = Date.now();
  await sleepAbortable(50);
  assert.ok(Date.now() - start >= 40);

  const controller = new AbortController();
  const p = sleepAbortable(5000, controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(async () => {
    await p;
  }, { name: 'AbortError' });
});
