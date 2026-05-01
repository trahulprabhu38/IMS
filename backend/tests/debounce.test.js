import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('BoundedQueue', () => {
  test('accepts items within capacity', async () => {
    const { BoundedQueue } = await import('../src/core/BoundedQueue.js');
    const q = new BoundedQueue(3);
    assert.equal(q.put('a'), true);
    assert.equal(q.put('b'), true);
    assert.equal(q.put('c'), true);
    assert.equal(q.size, 3);
  });

  test('returns false (backpressure) when full', async () => {
    const { BoundedQueue } = await import('../src/core/BoundedQueue.js');
    const q = new BoundedQueue(1);
    q.put('x');
    assert.equal(q.put('overflow'), false);
  });

  test('get() resolves items in FIFO order', async () => {
    const { BoundedQueue } = await import('../src/core/BoundedQueue.js');
    const q = new BoundedQueue(5);
    q.put('first');
    q.put('second');
    assert.equal(await q.get(), 'first');
    assert.equal(await q.get(), 'second');
  });

  test('get() waits when queue is empty then resolves on put()', async () => {
    const { BoundedQueue } = await import('../src/core/BoundedQueue.js');
    const q = new BoundedQueue(5);
    const getPromise = q.get();        // starts waiting
    q.put('late');                     // unblocks the waiter
    assert.equal(await getPromise, 'late');
  });
});

describe('TokenBucketRateLimiter', () => {
  test('allows requests within the rate', async () => {
    const { TokenBucketRateLimiter } = await import('../src/core/RateLimiter.js');
    const limiter = new TokenBucketRateLimiter(5);
    for (let i = 0; i < 5; i++) assert.equal(limiter.allow(), true);
  });

  test('blocks when tokens are exhausted', async () => {
    const { TokenBucketRateLimiter } = await import('../src/core/RateLimiter.js');
    const limiter = new TokenBucketRateLimiter(2);
    limiter.allow(); limiter.allow();
    assert.equal(limiter.allow(), false);
  });
});
