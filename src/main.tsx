import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

/** Last line of defence: if something unforeseen throws while rendering, show a way out instead of a blank page. */
class RootBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <main style={{ maxWidth: 560, margin: '3rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' }} role="alert">
        <h1>Something went wrong</h1>
        <p>The tool hit an unexpected error: <code>{this.state.err.message}</code></p>
        <p>Your model is saved in the address bar link. You can start again from the examples, or reload the page.</p>
        <button onClick={() => { history.replaceState(null, '', location.pathname); location.reload(); }}>Reset and reload</button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootBoundary>
      <App />
    </RootBoundary>
  </StrictMode>,
);
