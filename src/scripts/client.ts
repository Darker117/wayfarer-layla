import SandboxWorker from './worker?worker&inline';
import type { RunHook } from './runtime';
export const runHook: RunHook = (request, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
  const worker = new SandboxWorker();
  const cleanup = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort); };
  const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
  const timer = setTimeout(() => { cleanup(); reject(new Error('Script exceeded its 10-second worker limit. No changes were saved.')); }, 10000);
  signal?.addEventListener('abort', abort, { once: true });
  worker.onmessage = ({ data }) => { cleanup(); data.ok ? resolve(data.result) : reject(new Error(data.error)); };
  worker.onerror = event => { cleanup(); reject(new Error(event.message || 'The script sandbox could not start on this device.')); };
  worker.postMessage(request);
});
