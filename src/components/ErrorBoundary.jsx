// Error boundary to catch React errors and display a user-friendly message
// instead of a blank screen. Auto-reloads to recover from transient errors.
// Uses the same dark/light mode theme as the rest of the dashboard.
import { Component } from 'react';
import { Link } from 'react-router-dom';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary Caught]', error);
    console.error('[Component Stack]', info?.componentStack);
  }

  componentDidUpdate(prevProps, prevState) {
    // Auto-reload once to recover from a transient error (e.g. a stale chunk),
    // but NEVER loop: if we already reloaded in the last 10s, show the fallback
    // instead so a persistent render error can't brick the app forever.
    if (this.state.hasError && !prevState.hasError) {
      let last = 0;
      try { last = Number(sessionStorage.getItem('eb.reloadedAt')) || 0; } catch { /* ignore */ }
      if (Date.now() - last > 10000) {
        try { sessionStorage.setItem('eb.reloadedAt', String(Date.now())); } catch { /* ignore */ }
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'var(--font)',
          background: 'var(--surface, #fcfdff)',
          color: 'var(--heading, #1f2937)',
        }}>
          <div style={{
            maxWidth: 420,
            background: 'var(--card-bg, #ffffff)',
            borderRadius: 24,
            padding: '2rem',
            border: '1px solid var(--border, #e2e8f0)',
            boxShadow: '0 8px 32px rgba(0,61,130,0.1)',
          }}>
            {/* Loading spinner */}
            <div style={{
              width: 48,
              height: 48,
              border: '4px solid var(--border, #e2e8f0)',
              borderTopColor: 'var(--brand, #78b4fb)',
              borderRadius: '50%',
              margin: '0 auto 1rem',
              animation: 'spin 1s linear infinite',
            }} />
            <p style={{ 
              color: 'var(--body-alt, #9ca3af)', 
              fontSize: '0.8rem',
              margin: 0 
            }}>
              <Link to="/" style={{ color: 'var(--brand-deep, #1a6bb5)' }}>go home</Link>
            </p>
          </div>
          {/* Keyframe animation style */}
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      );
    }
    return this.props.children;
  }
}