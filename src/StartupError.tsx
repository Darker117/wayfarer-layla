import { NativeDatabaseUnavailableError } from './storage';

export default function StartupError({ error }: { error: unknown }) {
  const nativeFailure = error instanceof NativeDatabaseUnavailableError;
  const detail = nativeFailure ? error.cause : error;
  return <div className="boot-screen" role="alert">
    <h1>{nativeFailure ? 'Layla needs a full restart.' : 'Your library couldn’t be opened.'}</h1>
    {nativeFailure ? <>
      <p>Layla could not open its database connection. Reloading this page may repeat the same error.</p>
      <p>Open <strong>Android Settings → Apps → Layla → Force stop</strong>. Then launch Layla and open Wayfarer again.</p>
      <p>Your library has not been reset. Use Force stop only; keep Layla’s storage and app data.</p>
    </> : <>
      <p>Wayfarer could not safely load your saved library. It has not reset or replaced it.</p>
      <p>Try reopening Wayfarer. If the error persists, keep your existing data and any exported backups.</p>
    </>}
    <details><summary>Error details</summary><p className="startup-error-detail">{detail instanceof Error ? detail.message : String(detail)}</p></details>
    <button className="button primary" onClick={() => location.reload()}>Try again</button>
  </div>;
}
