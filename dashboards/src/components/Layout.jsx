import { useState, useEffect, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Bell from './Bell.jsx';
import CommandPalette from './CommandPalette.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import ViewSwitcher from './ViewSwitcher.jsx';
import Icon, { BrandMark } from './Icon.jsx';
import { filterNavForView, getAvailableViews, resolveActiveView } from '../views.js';

function useTabRevalidate() {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let hiddenAt = 0;
    const onHide = () => { if (document.visibilityState === 'hidden') hiddenAt = Date.now(); };
    const onShow = () => {
      if (document.visibilityState === 'visible' && hiddenAt && Date.now() - hiddenAt > 2000) {
        hiddenAt = 0;
        setRev((r) => r + 1);
      }
    };
    const onPageShow = (e) => { if (e.persisted) setRev((r) => r + 1); };
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
  return rev;
}

function ThemeToggleSlot() {
  return <ThemeToggle />;
}

function navLabelForPath(nav, pathname) {
  const links = nav.filter((n) => n.to);
  const exact = links.find((n) => n.end && pathname === n.to);
  if (exact) return exact.label;
  const sorted = [...links].sort((a, b) => b.to.length - a.to.length);
  const match = sorted.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  return match?.label;
}

// App shell: top bar + role-aware sidebar navigation.
export default function Layout({ children, nav = [] }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sent, setSent] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const rev = useTabRevalidate();

  // Mobile nav drawer: close on navigation and on Escape.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const views = useMemo(() => getAvailableViews(user), [user]);
  const activeView = useMemo(
    () => resolveActiveView(views, location.pathname, user?.id),
    [views, location.pathname, user?.id],
  );
  const filteredNav = useMemo(
    () => filterNavForView(nav, activeView?.id),
    [nav, activeView?.id],
  );
  const pageLabel = useMemo(
    () => navLabelForPath(filteredNav, location.pathname),
    [filteredNav, location.pathname],
  );

  const onLogout = () => {
    logout();
    navigate('/login');
  };

  const resend = () => api.resendVerification().then(() => setSent(true)).catch(() => setSent(true));

  return (
    <div className={`app-shell${navOpen ? ' nav-open' : ''}`}>
      {user && user.emailVerified === false && (
        <div className="verify-banner">
          Please verify your email to secure your account.{' '}
          {sent ? <strong>Verification email sent.</strong> : <button className="link-btn" onClick={resend}>Resend link</button>}
        </div>
      )}
      <header className="topbar">
        <button
          className="nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
        >
          <Icon name={navOpen ? 'x' : 'menu'} size={20} />
        </button>
        <div className="topbar-brand"><BrandMark size={22} />Synthica</div>
        <div className="topbar-right">
          <button className="cmdk-trigger" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} aria-label="Search">
            <Icon name="search" size={16} /> <span className="cmdk-hint">⌘K</span>
          </button>
          <ThemeToggleSlot />
          <Bell />
          <ViewSwitcher onLogout={onLogout} />
        </div>
      </header>
      <div className="app-body">
        <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
        <aside className="sidebar" aria-label="Main navigation">
          {filteredNav.map((item, i) => (
            item.spacer ? (
              <div key={`sp-${i}`} className="sidebar-spacer" />
            ) : item.section ? (
              <div key={`sec-${i}`} className="sidebar-section">{item.section}</div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setNavOpen(false)}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                {item.icon && <span className="sidebar-ico" aria-hidden="true"><Icon name={item.icon} size={18} /></span>}
                <span className="sidebar-label">{item.label}</span>
                {/* Optional numeric count (e.g. editor queue size); hidden at 0. */}
                {item.badge > 0 && (
                  <span className="badge badge-blue" style={{ marginLeft: 'auto', flex: 'none' }} aria-label={`${item.badge} waiting`}>
                    {item.badge}
                  </span>
                )}
              </NavLink>
            )
          ))}
        </aside>
        <main className="content" key={rev}>
          {activeView && pageLabel && pageLabel !== activeView.label && (
            <nav className="content-crumb" aria-label="Breadcrumb">
              <span className="content-crumb-view">{activeView.label}</span>
              <span className="content-crumb-sep" aria-hidden="true">/</span>
              <span className="content-crumb-page">{pageLabel}</span>
            </nav>
          )}
          {children}
        </main>
      </div>
      <CommandPalette nav={filteredNav} />
    </div>
  );
}
