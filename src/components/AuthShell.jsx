import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import { BrandMark } from './Icon.jsx';

/**
 * Single auth chrome for /login, /register, /forgot, /reset and /verify:
 * a quiet headline over one hairline card, locked to the viewport height
 * (a `body:has(.login-wrap.login-v3)` rule elsewhere depends on the class).
 * Pass mode="login" | "register" to show the sign-in/sign-up tabs.
 */
export default function AuthShell({ mode, children }) {
  const tabs = mode === 'login' || mode === 'register';
  return (
    <div className="login-wrap login-v3">
      <ThemeToggle className="login-theme" />
      <div className="login-scene">
        <header className="login-scene-head">
          <h2 className="login-scene-title">Your research journey starts here.</h2>
        </header>

        <div className="login-card login-card-v3">
          <div className="login-brand"><BrandMark size={24} />Synthica</div>

          {tabs && (
            <nav className="auth-tabs" aria-label="Authentication">
              <Link to="/login" className={`auth-tab ${mode === 'login' ? 'active' : ''}`}>Sign in</Link>
              <Link to="/register" className={`auth-tab ${mode === 'register' ? 'active' : ''}`}>Sign up</Link>
            </nav>
          )}

          <div className="auth-card-body">{children}</div>
          <div className="login-foot"><Link to="/archive">Browse the Synthica Archive →</Link></div>
        </div>
      </div>
    </div>
  );
}
