import { retryNetworkLoad, throwIfAborted, abortable } from './network-load.js';

/** Fetch, decode and report bytes. The owner can abort fetch and stream decoding. */
export async function loadBinary(rawUrl, gzipUrl, onProgress = () => {}, { signal } = {}) {
  const compressed = Boolean(gzipUrl) && typeof DecompressionStream !== 'undefined';
  return retryNetworkLoad(async () => {
    const response = await abortable(fetch(compressed ? gzipUrl : rawUrl, { signal }), signal);
    throwIfAborted(signal);
    if (!response.ok) throw new Error('Model asset unavailable (' + response.status + ')');
    const decodedByBrowser = /\bgzip\b/i.test(response.headers.get('content-encoding') || '');
    const length = decodedByBrowser ? 0 : Number(response.headers.get('content-length')) || 0;
    let loaded = 0;
    const progressStream = new TransformStream({ transform(chunk, controller) {
      throwIfAborted(signal); loaded += chunk.byteLength;
      onProgress(length ? Math.min(.99, loaded / length) : .4);
      // Let pipeThrough's abort cancel its upstream reader even when the
      // progress callback itself disposes the owner during this transform.
      controller.enqueue(chunk);
    } });
    const body = response.body || new Blob([await abortable(response.arrayBuffer(), signal)]).stream();
    throwIfAborted(signal);
    let stream = body.pipeThrough(progressStream, { signal });
    if (compressed && !decodedByBrowser) stream = stream.pipeThrough(new DecompressionStream('gzip'), { signal });
    const bytes = await abortable(new Response(stream).arrayBuffer(), signal);
    throwIfAborted(signal); onProgress(1); throwIfAborted(signal); return bytes;
  }, () => onProgress(0), { signal });
}
