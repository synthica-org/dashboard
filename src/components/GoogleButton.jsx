import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';

const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Cache the resolved client id across mounts (login → signup steps remount this
// component) so we don't re-hit /api/config every time.
let resolvedClientId = ENV_CLIENT_ID || null; // null = unknown, '' = confirmed off
let gisScriptPromise = null;

function loadGisScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisScriptPromise;
}

function useDarkTheme() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.dataset.theme === 'dark');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

// "Continue with Google" — renders the official Google Identity Services button.
// The OAuth client id comes from the build (VITE_GOOGLE_CLIENT_ID) or, failing
// that, from the backend /api/config (the id is public, so this is safe and
// means Google login works as long as the *backend* is configured).
//
// `text` is the GIS label key: 'continue_with' (default) or 'signup_with'.
export default function GoogleButton({ onSuccess, onError, text = 'continue_with' }) {
  const { loginWithGoogle } = useAuth();
  const ref = useRef(null);
  const dark = useDarkTheme();
  const [clientId, setClientId] = useState(resolvedClientId); // null until resolved
  const [width, setWidth] = useState(0);

  // Resolve the client id: env first, else ask the backend once.
  useEffect(() => {
    if (resolvedClientId !== null) { setClientId(resolvedClientId); return; }
    let alive = true;
    api.config()
      .then((c) => { resolvedClientId = c.googleClientId || ''; if (alive) setClientId(resolvedClientId); })
      .catch(() => { resolvedClientId = ''; if (alive) setClientId(''); });
    return () => { alive = false; };
  }, []);

  // Track the container width so the Google button always fills its column
  // (GIS clamps to 200–400px) instead of sitting at a fixed size in a box.
  useEffect(() => {
    if (!ref.current) return undefined;
    const measure = () => setWidth(Math.round(ref.current?.getBoundingClientRect().width || 0));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [clientId]);

  // Initialise + render the real Google button once we have an id and a width.
  useEffect(() => {
    if (!clientId || !ref.current || !width) return;
    let cancelled = false;
    loadGisScript()
      .then(() => {
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp) => {
            try { await loginWithGoogle(resp.credential); onSuccess?.(); }
            catch (e) { onError?.(e.message); }
          },
        });
        ref.current.innerHTML = '';
        window.google.accounts.id.renderButton(ref.current, {
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'rectangular', // matches the hairline card (Google brand colors stay — legit exception)
          text,
          logo_alignment: 'center',
          width: Math.max(200, Math.min(400, width)),
        });
      })
      .catch((e) => onError?.(e.message));
    return () => { cancelled = true; };
  }, [clientId, width, text, dark, loginWithGoogle, onError, onSuccess]);

  // Still resolving — reserve the row so the layout doesn't jump.
  if (clientId === null) return <div className="google-gsi" ref={ref} style={{ minHeight: 44 }} />;

  // Backend has no client id configured: show a clean, on-brand fallback that
  // explains what's missing rather than a dead button.
  if (clientId === '') {
    return (
      <button
        type="button"
        className="google-btn"
        onClick={() => onError?.('Google sign-in isn’t configured yet — set GOOGLE_CLIENT_ID on the backend. See DEPLOY.md.')}
      >
        <GoogleG /> Continue with Google
      </button>
    );
  }

  // The div IS the button — GIS renders into it; we keep it full-width and
  // unboxed so it stands on its own.
  return <div className="google-gsi" ref={ref} />;
}
