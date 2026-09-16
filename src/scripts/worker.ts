import { runIsolated, type HookRequest } from './runtime';
self.onmessage = async (event: MessageEvent<HookRequest>) => {
  try { self.postMessage({ ok: true, result: await runIsolated(event.data) }); }
  catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
