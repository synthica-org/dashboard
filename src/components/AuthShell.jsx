import { Link } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import Icon, { BrandMark } from './Icon.jsx';

const SIGNALS = [
  { icon: 'file-text', title: 'Open journal', text: 'Peer-reviewed papers with DOI — no paywall.' },
  { icon: 'globe', title: 'Global network', text: 'Researchers across 93+ countries in one hub.' },
  { icon: 'award', title: 'Verified roles', text: 'Earn certificates you can share anywhere.' },
];

function LoginBackdrop() {
  return (
    <div className="login-signals" aria-hidden="true">
      {SIGNALS.map((s, i) => (
        <div key={s.title} className={`login-signal login-signal-${String.fromCharCode(97 + i)}`}>
          <span className="login-signal-ico"><Icon name={s.icon} size={18} /></span>
          <div>
            <strong>{s.title}</strong>
            {s.text}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shared layout for /login and /register — locked to one viewport height. */
export default function AuthShell({ mode = 'login', children }) {
  return (
    <div className="login-wrap login-v3">
      <ThemeToggle className="login-theme" />
      <LoginBackdrop />
      <div className="login-scene">
        <header className="login-scene-head">
          <h2 className="login-scene-title">
            Your research journey{' '}
            <em className="login-scene-accent">starts here</em>
            <span className="login-scene-period" aria-hidden="true">.</span>
          </h2>
        </header>

        <div className="login-card login-card-v3">
          <div className="login-brand"><BrandMark size={24} />Synthica</div>

          <nav className="auth-tabs" aria-label="Authentication">
            <Link to="/login" className={`auth-tab ${mode === 'login' ? 'active' : ''}`}>Sign in</Link>
            <Link to="/register" className={`auth-tab ${mode === 'register' ? 'active' : ''}`}>Sign up</Link>
          </nav>

          <div className="auth-card-body">{children}</div>
          <div className="login-foot"><Link to="/archive">Browse the Synthica Archive →</Link></div>
        </div>
      </div>
    </div>
  );
}
