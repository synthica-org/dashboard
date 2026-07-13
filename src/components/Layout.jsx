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

function navLabelForPath(nav, pathname) {
  const links = nav.filter((n) => n.to);
  const exact = links.find((n) => n.end && pathname === n.to);
  if (exact) return exact.label;
  const sorted = [...links].sort((a, b) => b.to.length - a.to.length);
  const match = sorted.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  return match?.label;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// App shell: workspace sidebar (on the canvas) + framed content window.
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

  // ⌥1–⌥9 jump to the nth sidebar destination (matches the hint chips).
  // `hidden` items are ⌘K-only: they stay in the nav array (palette + breadcrumb)
  // but never render a row or consume a shortcut.
  const linkItems = useMemo(() => filteredNav.filter((n) => n.to && !n.hidden), [filteredNav]);
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      const item = linkItems[Number(m[1]) - 1];
      if (item) { e.preventDefault(); navigate(item.to); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkItems, navigate]);

  const shortcutIndex = (item) => {
    const i = linkItems.indexOf(item);
    return i > -1 && i < 9 ? i + 1 : null;
  };

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
      <div className="app-body">
        <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-brand"><BrandMark size={18} /><span>Synthica</span></div>
          <div className="sidebar-workspace">
            <ViewSwitcher onLogout={onLogout} />
          </div>
          <div className="sidebar-nav">
            {filteredNav.filter((item) => !item.hidden).map((item, i) => (
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
                  {item.icon && <span className="sidebar-ico" aria-hidden="true"><Icon name={item.icon} size={16} /></span>}
                  <span className="sidebar-label">{item.label}</span>
                  {/* Items that leave the dashboard shell for the public site get an explicit cue. */}
                  {item.external && (
                    <span className="sidebar-ext" aria-label="opens the public site" title="Opens the public site">
                      <Icon name="external-link" size={13} />
                    </span>
                  )}
                  {/* Optional numeric count (e.g. editor queue size); hidden at 0. */}
                  {item.badge > 0 ? (
                    <span className="badge badge-blue sidebar-badge" aria-label={`${item.badge} waiting`}>
                      {item.badge}
                    </span>
                  ) : shortcutIndex(item) && (
                    <kbd className="sidebar-kbd" aria-hidden="true">{isMac ? '⌥' : 'Alt'}{shortcutIndex(item)}</kbd>
                  )}
                </NavLink>
              )
            ))}
          </div>
        </aside>
        <div className="content-frame">
          <header className="content-head">
            <button
              className="nav-toggle"
              onClick={() => setNavOpen((v) => !v)}
              aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={navOpen}
            >
              <Icon name={navOpen ? 'x' : 'menu'} size={20} />
            </button>
            {activeView && (
              <nav className="content-crumb" aria-label="Breadcrumb">
                <span className="content-crumb-view">{activeView.label}</span>
                {pageLabel && pageLabel.toLowerCase() !== activeView.label.toLowerCase() && (
                  <>
                    <span className="content-crumb-sep" aria-hidden="true"><Icon name="chevron-right" size={13} /></span>
                    <span className="content-crumb-page">{pageLabel}</span>
                  </>
                )}
              </nav>
            )}
            <div className="content-head-right">
              <button className="cmdk-trigger" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} aria-label="Search">
                <Icon name="search" size={15} /> <span className="cmdk-label">Search</span> <span className="cmdk-hint">⌘K</span>
              </button>
              <ThemeToggle />
              <Bell />
            </div>
          </header>
          <main className="content" key={rev}>
            <div className="content-inner">
              {children}
            </div>
          </main>
        </div>
      </div>
      <CommandPalette nav={filteredNav} />
    </div>
  );
}
