import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Button, Field } from '../components/ui.jsx';
import GoogleButton from '../components/GoogleButton.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { getDefaultHomePath, canAccessPortal } from '../views.js';

// Emails match the seeded demo accounts (backend/src/seed.js). "Moderator" is the
// member-facing name for the Auditor role (ROLE_WORKFLOWS §9).
const DEMO_ACCOUNTS = [
  { label: 'All views (demo)', email: 'testall@synthica.org' },
  { label: 'Admin', email: 'admin@synthica.org' },
  { label: 'Director', email: 'director@synthica.org' },
  { label: 'Moderator', email: 'auditor@synthica.org' },
  { label: 'Lead researcher', email: 'sam@example.com' },
  { label: 'Associate researcher', email: 'jordan@example.com' },
  { label: 'Independent researcher', email: 'testindependent@synthica.org' },
  { label: 'Expertise mentor', email: 'testmentor@synthica.org' },
];

export default function Login() {
  const { login, verify2fa } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const expired = params.get('expired');
  // Journal funnel (?from=journal): authors arriving from the public journal
  // site land on My Journal after signing in instead of their default home.
  const fromJournal = params.get('from') === 'journal';
  const ref = params.get('ref') || ''; // carried through to /register untouched
  const registerQuery = (() => {
    const q = new URLSearchParams();
    if (ref) q.set('ref', ref);
    if (fromJournal) q.set('from', 'journal');
    const s = q.toString();
    return s ? `?${s}` : '';
  })();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFA, setTwoFA] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(true);

  useEffect(() => {
    api.config().then((c) => setDemoEnabled(c.demoLogins !== false)).catch(() => {});
  }, []);

  const goHome = (user) => navigate(
    fromJournal && canAccessPortal(user, 'researcher') ? '/researcher/journal' : getDefaultHomePath(user),
    { replace: true },
  );
  const fail = (e) => setError(e.message || String(e));

  const doLogin = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await login(email.trim(), password.trim());
      if (res.twoFactorRequired) {
        setTwoFA({ tempToken: res.tempToken });
      } else {
        goHome(res);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const demoLogin = async (demoEmail) => {
    setError('');
    setBusy(true);
    try {
      const res = await login(demoEmail, 'demo1234');
      if (res.twoFactorRequired) {
        setEmail(demoEmail);
        setTwoFA({ tempToken: res.tempToken });
      } else {
        goHome(res);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      goHome(await verify2fa(twoFA.tempToken, code.trim()));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (twoFA) {
    return (
      <AuthShell mode="login">
        <h1>Two-factor code</h1>
        <p className="sub">Enter the 6-digit code from your authenticator app.</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={doVerify}>
          <Field label="Authentication code">
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoFocus maxLength={6} required />
          </Field>
          <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Verifying…' : 'Verify'}</Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell mode="login">
      <h1>Sign in</h1>
      <p className="sub">Welcome back — enter your credentials to continue.</p>
      {expired && !error && <div className="login-error alert-warning">Your session expired — please sign in again.</div>}
      {error && <div className="login-error">{error}</div>}

      <GoogleButton onSuccess={() => navigate(fromJournal ? '/researcher/journal' : '/', { replace: true })} onError={setError} />
      <div className="login-divider"><span>or with email</span></div>

      <form onSubmit={doLogin}>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
            placeholder="you@school.edu"
            required
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </Field>
        <div className="login-hint login-forgot">
          <Link to="/forgot">Forgot password?</Link>
        </div>
        <Button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="login-hint auth-link-row">
        Don&apos;t have an account? <Link to={`/register${registerQuery}`}>Create one</Link>
      </div>

      {demoEnabled && (
        <details className="login-demo">
          <summary>Demo accounts</summary>
          <div className="login-hint auth-demo-hint">One click — no email or password needed:</div>
          <div className="login-demo-grid">
            {DEMO_ACCOUNTS.map(({ label, email: demoEmail }) => (
              <button key={demoEmail} type="button" className="demo-btn" disabled={busy} onClick={() => demoLogin(demoEmail)} title={demoEmail}>
                {label}
              </button>
            ))}
          </div>
        </details>
      )}
    </AuthShell>
  );
}
