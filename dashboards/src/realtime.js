// Real-time client: a single Server-Sent-Events connection to /api/stream that
// fans server events (new message, new notification) out to subscribers, so the
// feed, the bell, and open chat threads update live instead of on refresh.
//
// Reliability goals (unit #18):
//   • ONE shared connection regardless of how many components subscribe.
//   • Explicit reconnect with exponential backoff + jitter — we don't rely on
//     the browser's opaque auto-reconnect, so a dropped link always recovers.
//   • The connection survives subscriber churn: unmounting the last component
//     does NOT immediately tear down the socket (avoids reconnect storms when
//     routes swap the bell/feed in and out). It closes after a short grace.
//   • Resilient to token refresh: if the auth token changes (re-login, refresh),
//     we reconnect with the new token instead of streaming as the old user.
//   • Errors are logged in dev, never silently swallowed.
import { useEffect, useRef, useState } from 'react';
import { apiBase, getToken } from './api.js';

const TYPES = ['message', 'notification', 'ready'];
const handlers = { message: new Set(), notification: new Set(), ready: new Set() };
const statusListeners = new Set(); // notified with 'connected' | 'connecting' | 'offline'

const isDev = (() => {
  try { return !!import.meta.env?.DEV; } catch { return false; }
})();
const log = (...a) => { if (isDev) console.warn('[realtime]', ...a); };

let es = null;
let refs = 0;
let connectedToken = null; // token the current EventSource was opened with
let retries = 0;
let reconnectTimer = null;
let closeTimer = null;
let status = 'offline';

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
}

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

// Exponential backoff with jitter, capped at 30s: 1s, 2s, 4s, 8s … (±20%).
function backoffDelay() {
  const base = Math.min(30000, 1000 * 2 ** retries);
  return base * (0.8 + Math.random() * 0.4);
}

function teardown() {
  if (es) {
    es.onopen = es.onerror = null;
    try { es.close(); } catch { /* ignore */ }
    es = null;
  }
  connectedToken = null;
}

function scheduleReconnect() {
  clearReconnect();
  if (refs <= 0) return; // nobody listening — stay closed
  const delay = backoffDelay();
  retries += 1;
  log(`reconnecting in ${Math.round(delay)}ms (attempt ${retries})`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, delay);
}

function open() {
  clearReconnect();
  const token = getToken();
  if (!token) { setStatus('offline'); return; } // signed out — nothing to stream
  // Already connected with the current token: nothing to do.
  if (es && connectedToken === token) return;
  // Token changed (refresh / re-login) or stale socket: rebuild from scratch.
  teardown();

  setStatus('connecting');
  let source;
  try {
    source = new EventSource(`${apiBase}/api/stream?token=${encodeURIComponent(token)}`);
  } catch (err) {
    log('failed to open EventSource', err?.message || err);
    scheduleReconnect();
    return;
  }
  es = source;
  connectedToken = token;

  source.onopen = () => {
    retries = 0;
    setStatus('connected');
    log('connected');
  };

  for (const type of TYPES) {
    source.addEventListener(type, (e) => {
      // 'ready' is the server's hello/heartbeat — treat it as a healthy
      // connection and reset backoff even if onopen was missed.
      if (type === 'ready') { retries = 0; setStatus('connected'); }
      let data = {};
      try { data = e.data ? JSON.parse(e.data) : {}; } catch { /* non-JSON payload */ }
      handlers[type].forEach((fn) => {
        try { fn(data); } catch (err) { log(`handler for "${type}" threw`, err?.message || err); }
      });
    });
  }

  source.onerror = () => {
    // EventSource fires onerror on transient drops (and would auto-retry), but
    // its retry is opaque and can stall. Take control: close and back off so
    // recovery is predictable and observable. (readyState OPEN means a
    // recoverable hiccup the browser is already handling — leave it alone.)
    if (source.readyState !== EventSource.OPEN) {
      log('connection error — will reconnect');
      setStatus('connecting');
      teardown();
      scheduleReconnect();
    }
  };
}

function ensureOpen() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  // Reconnect if disconnected, or if the token changed since we connected.
  if (!es || connectedToken !== getToken()) {
    retries = 0;
    open();
  }
}

function maybeClose() {
  // Grace period: routes mount/unmount the bell & feed constantly. Only close
  // once nothing has needed the stream for a moment.
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (refs <= 0) {
      clearReconnect();
      teardown();
      retries = 0;
      setStatus('offline');
      log('closed (no subscribers)');
    }
  }, 3000);
}

// Subscribe a component to a realtime event type for its lifetime.
export function useRealtime(type, handler) {
  const saved = useRef(handler);
  saved.current = handler;
  useEffect(() => {
    refs += 1;
    ensureOpen();
    const fn = (data) => saved.current?.(data);
    handlers[type]?.add(fn);
    return () => {
      handlers[type]?.delete(fn);
      refs -= 1;
      if (refs <= 0) maybeClose();
    };
  }, [type]);
}

// Observe the connection status ('connected' | 'connecting' | 'offline').
// The bell uses this to show a subtle "reconnecting" hint instead of going
// silent when the link drops.
export function useRealtimeStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    setS(status);
    statusListeners.add(setS);
    return () => statusListeners.delete(setS);
  }, []);
  return s;
}

// Force a reconnect with the latest token — call after login so the stream
// attaches to the new session immediately instead of waiting for a remount.
export function reconnectRealtime() {
  if (refs <= 0) return;
  retries = 0;
  teardown();
  open();
}

// Recover fast when the tab/network comes back instead of waiting out the
// backoff timer. The browser fires these on resume/reconnect.
if (typeof window !== 'undefined') {
  const kick = () => { if (refs > 0 && (!es || status !== 'connected')) { retries = 0; open(); } };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
}
