import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useRealtime, useRealtimeStatus } from '../realtime.js';
import Icon from './Icon.jsx';

// Relative "time ago" for the dropdown ("just now", "5m", "3h", "2d") with the
// absolute timestamp on hover. Falls back gracefully on a bad/missing date.
function timeAgo(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

// Notification bell with an unread badge + dropdown. Updates live over SSE; a
// 60s poll is kept only as a fallback for when the stream is down.
export default function Bell() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const rtStatus = useRealtimeStatus();

  const load = useCallback(
    () => api.notifications().then((xs) => setItems(Array.isArray(xs) ? xs : [])).catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
    // Fallback poll only — SSE is the primary path. Kept slow so it's cheap.
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);
  useRealtime('notification', load); // new notification pushed → refresh instantly

  // Close on outside click + Escape.
  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const unread = items.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    const ids = items.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    // Optimistic: flip locally, then persist the specific ids.
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    api.markNotificationsRead(ids).catch(() => load()); // reload to resync on failure
  }, [items, load]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread) markAllRead();
  };

  const go = (n) => {
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div className="bell" ref={ref}>
      <button className="bell-btn" onClick={toggle} aria-label={label} aria-haspopup="true" aria-expanded={open}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-menu" role="menu">
          <div className="bell-head">
            <span>Notifications</span>
            {rtStatus !== 'connected' && (
              <span className="bell-status" title="Reconnecting to live updates">• reconnecting…</span>
            )}
          </div>
          {items.length === 0 ? (
            <div className="bell-empty">
              <div className="bell-empty-icon" aria-hidden="true"><Icon name="bell" size={24} /></div>
              You're all caught up.
              <div className="bell-empty-sub">New activity shows up here in real time.</div>
            </div>
          ) : (
            items.slice(0, 20).map((n) => (
              <button
                key={n.id}
                className={`bell-item ${n.read ? '' : 'unread'}`}
                onClick={() => go(n)}
                role="menuitem"
              >
                <div className="bell-title">{n.title}</div>
                {n.body && <div className="bell-body">{n.body}</div>}
                <div className="bell-time" title={n.at ? new Date(n.at).toLocaleString() : ''}>{timeAgo(n.at)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
