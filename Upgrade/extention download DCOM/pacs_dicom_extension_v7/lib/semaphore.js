'use strict';

/**
 * AsyncSemaphore: Abort-aware semaphore queue preventing deadlocks and permit leaks.
 * Enforces concurrent active limit, supports AbortSignal upon user cancellation.
 */
export class AsyncSemaphore {
  constructor(limit = 12) {
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async acquire(signal) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          if (waiter.settled) return;
          waiter.settled = true;
          this.active++;
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (err) => {
          if (waiter.settled) return;
          waiter.settled = true;
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          reject(err);
        },
        settled: false,
      };
      let onAbort = null;
      if (signal) {
        onAbort = () => {
          const idx = this.waiters.indexOf(waiter);
          if (idx !== -1) this.waiters.splice(idx, 1);
          waiter.reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    while (this.waiters.length > 0) {
      const next = this.waiters.shift();
      if (!next.settled) {
        next.resolve();
        break;
      }
    }
  }
}

/**
 * sleepAbortable: Sleep with instant interruption via AbortSignal.
 */
export function sleepAbortable(ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    let onAbort = null;
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * fetchStreamWithTimeout: Stream chunk reader with rolling idle timeout on new bytes,
 * connection timeout, idle timeout, and max request duration cap.
 */
export async function fetchStreamWithTimeout(url, task, accept, signal, semaphore, headersFn, {
  idleMs = 60000,
  maxMs = 180000,
  connectMs = 30000,
} = {}) {
  if (semaphore) await semaphore.acquire(signal);
  const controller = new AbortController();
  let onParentAbort = null;
  if (signal) {
    onParentAbort = () => controller.abort(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) onParentAbort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }
  let connectTimer = null, idleTimer = null, maxTimer = null, timedOut = false, timeoutReason = '';
  const clearTimers = () => {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
  };
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      timeoutReason = `Idle timeout (${idleMs / 1000}s)`;
      controller.abort();
    }, idleMs);
  };
  connectTimer = setTimeout(() => {
    timedOut = true;
    timeoutReason = `Connect timeout (${connectMs / 1000}s)`;
    controller.abort();
  }, connectMs);
  maxTimer = setTimeout(() => {
    timedOut = true;
    timeoutReason = `Max request timeout (${maxMs / 1000}s)`;
    controller.abort();
  }, maxMs);

  try {
    const reqHeaders = typeof headersFn === 'function' ? headersFn(task, accept) : undefined;
    const method = String(task?.method || 'GET').toUpperCase();
    const r = await fetch(url, {
      method,
      body: ['GET','HEAD'].includes(method) ? undefined : task?.body,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      headers: reqHeaders,
      signal: controller.signal,
    });
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const contentType = r.headers.get('content-type') || '';
    const reader = r.body?.getReader();
    if (!reader) {
      const b = new Uint8Array(await r.arrayBuffer());
      return { bytes: b, contentType };
    }
    const chunks = [];
    let totalLen = 0;
    resetIdle();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        chunks.push(value);
        totalLen += value.length;
        resetIdle();
      }
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return { bytes: out, contentType };
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (timedOut) throw new Error(timeoutReason || 'Request timeout');
    throw e;
  } finally {
    clearTimers();
    if (signal && onParentAbort) signal.removeEventListener('abort', onParentAbort);
    if (semaphore) semaphore.release();
  }
}

