import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import {
  getAvailableViews,
  resolveActiveView,
  saveActiveViewId,
} from '../views.js';

/** Top-right menu: switch workspace by role + account actions. */
export default function ViewSwitcher({ onLogout }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);

  const views = useMemo(() => getAvailableViews(user), [user]);
  const activeView = useMemo(
    () => resolveActiveView(views, location.pathname, user?.id),
    [views, location.pathname, user?.id],
  );

  const workspaceViews = views.filter((v) => v.kind !== 'shared');
  const accountPath = location.pathname.startsWith('/researcher')
    ? '/researcher/account'
    : user?.kind === 'researcher'
      ? '/researcher/account'
      : '/editor/account';

  useEffect(() => {
    if (activeView?.id) saveActiveViewId(activeView.id, user?.id);
  }, [activeView?.id, user?.id]);

  useEffect(() => {
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const pickView = (view) => {
    setOpen(false);
    saveActiveViewId(view.id, user?.id);
    if (location.pathname !== view.path) navigate(view.path);
  };

  const goAccount = () => {
    setOpen(false);
    navigate(accountPath);
  };

  if (!user) return null;

  return (
    <div className="view-switcher" ref={ref}>
      <button
        type="button"
        className="view-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="view-switcher-avatar" aria-hidden="true">
          {(user.name || '?').trim().charAt(0).toUpperCase()}
        </span>
        <span className="view-switcher-text">
          <span className="view-switcher-name">{user.name}</span>
          <span className="view-switcher-role">{activeView?.label || 'Dashboard'}</span>
        </span>
        <Icon name="chevron-down" size={16} className="view-switcher-chevron" />
      </button>

      {open && (
        <div className="view-switcher-menu" role="menu">
          <div className="view-switcher-head">
            <div className="view-switcher-head-name">{user.name}</div>
            <div className="view-switcher-head-email">{user.email}</div>
          </div>

          {workspaceViews.length > 0 && (
            <>
              <div className="view-switcher-label">Your views</div>
              {workspaceViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeView?.id === view.id}
                  className={`view-switcher-item ${activeView?.id === view.id ? 'active' : ''}`}
                  onClick={() => pickView(view)}
                >
                  <span className="view-switcher-item-ico" aria-hidden="true">
                    <Icon name={view.icon} size={18} />
                  </span>
                  <span className="view-switcher-item-body">
                    <span className="view-switcher-item-title">{view.label}</span>
                    <span className="view-switcher-item-sub">{view.description}</span>
                  </span>
                  {activeView?.id === view.id && (
                    <Icon name="check" size={16} className="view-switcher-check" />
                  )}
                </button>
              ))}
            </>
          )}

          {views.some((v) => v.kind === 'shared') && (
            <>
              <div className="view-switcher-label">Public</div>
              {views.filter((v) => v.kind === 'shared').map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="menuitem"
                  className={`view-switcher-item ${activeView?.id === view.id ? 'active' : ''}`}
                  onClick={() => pickView(view)}
                >
                  <span className="view-switcher-item-ico" aria-hidden="true">
                    <Icon name={view.icon} size={18} />
                  </span>
                  <span className="view-switcher-item-body">
                    <span className="view-switcher-item-title">{view.label}</span>
                    <span className="view-switcher-item-sub">{view.description}</span>
                  </span>
                </button>
              ))}
            </>
          )}

          <div className="view-switcher-divider" />
          <button type="button" role="menuitem" className="view-switcher-action" onClick={goAccount}>
            <Icon name="user" size={16} /> Account settings
          </button>
          <button type="button" role="menuitem" className="view-switcher-action danger" onClick={onLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
