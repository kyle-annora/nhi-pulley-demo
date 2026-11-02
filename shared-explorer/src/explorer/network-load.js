/** Abort checks are shared by transport, renderer and DOM adapters. */
export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
}

/** Stop waiting without cancelling shared asset preparation owned by the scene. */
export function abortable(promise, ...signals) {
  const active = signals.filter(Boolean);
  if (!active.length) return promise;
  return new Promise((resolve, reject) => {
    const clean = () => active.forEach(signal => signal.removeEventListener('abort', abort));
    const abort = () => { clean(); const signal = active.find(item => item.aborted); reject(signal?.reason || new DOMException('The operation was aborted.', 'AbortError')); };
    for (const signal of active) signal.addEventListener('abort', abort, { once: true });
    // Always observe the source promise, including an already-aborted request.
    Promise.resolve(promise).then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
    if (active.some(signal => signal.aborted)) abort();
  });
}

/** Retry one interrupted browser fetch, never an abort, HTTP or parsing error. */
export async function retryNetworkLoad(load, onRetry = () => {}, { signal } = {}) {
  throwIfAborted(signal);
  try {
    const result = await load(); throwIfAborted(signal); return result;
  } catch (error) {
    throwIfAborted(signal);
    if (!(error instanceof TypeError) || !/fetch|network|load failed/i.test(error.message)) throw error;
    onRetry(); throwIfAborted(signal);
    const result = await load(); throwIfAborted(signal); return result;
  }
}
