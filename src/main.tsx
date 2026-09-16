import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { setupDevelopment } from './host';
import { createRepository } from './storage';
import './style.css';
import './neumorphic.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="boot-screen"><h1>Something interrupted the page.</h1><p>{this.state.error}</p><button className="button primary" onClick={() => location.reload()}>Reopen Wayfarer</button><p>Your last saved data remains on this device.</p></div> : this.props.children; }
}
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<div className="boot-screen"><span className="boot-compass">✧</span><h1>wayfarer</h1><p>Opening your writing room…</p></div>);
async function boot() {
  try { await setupDevelopment(); const { repository, kind } = createRepository(); const store = await repository.load(); root.render(<ErrorBoundary><App initial={store} repository={repository} storageKind={kind}/></ErrorBoundary>); }
  catch(e) { root.render(<div className="boot-screen"><h1>Your library couldn’t be opened.</h1><p>{(e as Error).message}</p><p>No data was overwritten. Reopen the mini app in Layla and try again.</p><button className="button primary" onClick={() => location.reload()}>Try again</button></div>); }
}
void boot();
