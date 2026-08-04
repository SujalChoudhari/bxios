import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingMap, createPendingMap } from '../src/index.js';

describe('PendingMap Correlation Engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('registers a pending request, resolves it, asserts value and entry deletion', async () => {
    const map = new PendingMap();
    let resolveFn!: (val: any) => void;
    let rejectFn!: (err: any) => void;

    const promise = new Promise((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });

    map.add('req-1', { resolve: resolveFn, reject: rejectFn });

    expect(map.has('req-1')).toBe(true);
    expect(map.get('req-1')).toBeDefined();
    expect(map.get('req-1')?.id).toBe('req-1');
    expect(map.size).toBe(1);

    const testValue = { status: 200, data: 'hello world' };
    map.resolve('req-1', testValue);

    await expect(promise).resolves.toEqual(testValue);
    expect(map.has('req-1')).toBe(false);
    expect(map.get('req-1')).toBeUndefined();
    expect(map.size).toBe(0);
  });

  it('registers a pending request and lets timeout fire, rejecting with ECONNABORTED / 408 error', async () => {
    const map = new PendingMap({ defaultTimeout: 1000 });
    let rejectFn!: (err: any) => void;
    let resolveFn!: (val: any) => void;

    const promise = new Promise((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });

    const mockConfig = { url: '/api/test', method: 'GET' };
    map.add('req-timeout', {
      resolve: resolveFn,
      reject: rejectFn,
      config: mockConfig,
    });

    expect(map.has('req-timeout')).toBe(true);

    // Advance timer past the 1000ms threshold
    vi.advanceTimersByTime(1001);

    await expect(promise).rejects.toMatchObject({
      code: 'ECONNABORTED',
      message: 'timeout of 1000ms exceeded',
      isAxiosError: true,
      statusCode: 408,
      config: mockConfig,
    });

    expect(map.has('req-timeout')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('supports per-request timeout overriding default timeout', async () => {
    const map = new PendingMap({ defaultTimeout: 5000 });
    let rejectFn!: (err: any) => void;

    const promise = new Promise((_, rej) => {
      rejectFn = rej;
    });

    // Override with 200ms timeout passed via add argument
    map.add('req-override', { resolve: () => {}, reject: rejectFn }, 200);

    vi.advanceTimersByTime(250);

    await expect(promise).rejects.toMatchObject({
      code: 'ECONNABORTED',
      message: 'timeout of 200ms exceeded',
      statusCode: 408,
    });
  });

  it('registers multiple pending requests, resolves one and rejects another independently', async () => {
    const map = new PendingMap();

    let res1!: (val: any) => void;
    let rej1!: (err: any) => void;
    const promise1 = new Promise((res, rej) => {
      res1 = res;
      rej1 = rej;
    });

    let res2!: (val: any) => void;
    let rej2!: (err: any) => void;
    const promise2 = new Promise((res, rej) => {
      res2 = res;
      rej2 = rej;
    });

    let res3!: (val: any) => void;
    let rej3!: (err: any) => void;
    const promise3 = new Promise((res, rej) => {
      res3 = res;
      rej3 = rej;
    });

    map.add('req-1', { resolve: res1, reject: rej1 });
    map.add('req-2', { resolve: res2, reject: rej2 });
    map.add('req-3', { resolve: res3, reject: rej3 });

    expect(map.size).toBe(3);

    // Resolve req-1
    map.resolve('req-1', 'result-1');
    await expect(promise1).resolves.toBe('result-1');
    expect(map.has('req-1')).toBe(false);

    // Reject req-2
    map.reject('req-2', new Error('Failed req-2'));
    await expect(promise2).rejects.toThrow('Failed req-2');
    expect(map.has('req-2')).toBe(false);

    // Assert req-3 remains pending
    expect(map.has('req-3')).toBe(true);
    expect(map.size).toBe(1);

    // Resolve req-3
    map.resolve('req-3', 'result-3');
    await expect(promise3).resolves.toBe('result-3');
    expect(map.size).toBe(0);
  });

  it('calls teardown() and rejects ALL pending requests with clean disconnect error', async () => {
    const map = new PendingMap();

    const p1 = new Promise((resolve, reject) => map.add('r1', { resolve, reject }));
    const p2 = new Promise((resolve, reject) => map.add('r2', { resolve, reject }));
    const p3 = new Promise((resolve, reject) => map.add('r3', { resolve, reject }));

    expect(map.size).toBe(3);

    map.teardown();

    await expect(p1).rejects.toMatchObject({
      code: 'ECONNRESET',
      message: 'Client disconnected (ECONNRESET)',
      isAxiosError: true,
      statusCode: 503,
    });
    await expect(p2).rejects.toMatchObject({
      code: 'ECONNRESET',
    });
    await expect(p3).rejects.toMatchObject({
      code: 'ECONNRESET',
    });

    expect(map.size).toBe(0);
    expect(map.has('r1')).toBe(false);
    expect(map.has('r2')).toBe(false);
    expect(map.has('r3')).toBe(false);
  });

  it('teardown accepts custom disconnect error', async () => {
    const map = new PendingMap();
    const customErr = new Error('Custom WebSocket Close');

    const p1 = new Promise((resolve, reject) => map.add('r1', { resolve, reject }));

    map.teardown(customErr);

    await expect(p1).rejects.toThrow('Custom WebSocket Close');
    expect(map.size).toBe(0);
  });

  it('clears timer when resolved before timeout so no late rejection occurs', async () => {
    const map = new PendingMap({ defaultTimeout: 1000 });
    let resolveFn!: (val: any) => void;
    let rejectFn = vi.fn();

    const promise = new Promise((res) => {
      resolveFn = res;
    });

    map.add('req-early', { resolve: resolveFn, reject: rejectFn });

    // Resolve at 500ms
    vi.advanceTimersByTime(500);
    map.resolve('req-early', 'fast response');

    await expect(promise).resolves.toBe('fast response');

    // Advance past timeout
    vi.advanceTimersByTime(1000);

    expect(rejectFn).not.toHaveBeenCalled();
    expect(map.has('req-early')).toBe(false);
  });

  it('handles setTimeout() instance level method and createPendingMap factory', () => {
    const map = createPendingMap();
    expect(map.getTimeout()).toBe(0);

    map.setTimeout(3000);
    expect(map.getTimeout()).toBe(3000);
  });

  it('gracefully handles resolve/reject calls on non-existent IDs', () => {
    const map = new PendingMap();
    expect(() => map.resolve('non-existent', 'val')).not.toThrow();
    expect(() => map.reject('non-existent', 'err')).not.toThrow();
  });
});
