import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Button, Field } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import GoogleButton from '../components/GoogleButton.jsx';

// Public researcher self-registration. Email + Discord are required (point of
// contact), matching the submission/registration policy.
export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ref = params.get('ref') || ''; // referral code from a shared invite link
  // Prospective authors arriving from the public journal site (?from=journal):
  // tailor the copy and land them on My Journal after signup so they can submit.
  const fromJournal = params.get('from') === 'journal';
  const destination = fromJournal ? '/researcher/journal' : '/researcher';
  // Keep the funnel params when hopping between /register and /login. The
  // Google flow needs no extra state: GIS signs in via a callback on this page
  // (no redirect), so `ref` and `from` stay in the URL until we navigate.
  const authQuery = (() => {
    const q = new URLSearchParams();
    if (ref) q.set('ref', ref);
    if (fromJournal) q.set('from', 'journal');
    const s = q.toString();
    return s ? `?${s}` : '';
  })();
  const [form, setForm] = useState({ name: '', email: '', discord: '', password: '', resumeUrl: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register({ ...form, ref });
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap login-v2">
      <form className="login-card login-card-v2" onSubmit={onSubmit}>
        <div className="login-brand"><img className="brand-img" src="/assets/logo/logo.png" alt="" />Synthica</div>
        <h1>{fromJournal ? 'Submit to the Synthica Journal' : 'Join Synthica'}</h1>
        <p className="sub">
          {fromJournal
            ? 'Submitting to Synthica Journal? Create your free researcher account — you’ll submit and track your paper from My Journal.'
            : 'Create your free researcher account — join projects, a global community, programs, and competitions.'}
        </p>

        {fromJournal && (
          <div className="login-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--brand-deep)' }}>
            <Icon name="book-open" size={16} /> After you sign up, we&apos;ll take you straight to My Journal to submit your paper.
          </div>
        )}
        {ref && (
          <div className="login-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--brand-deep)' }}>
            <Icon name="party" size={16} /> You were invited — your referrer gets the credit when you join.
          </div>
        )}
        {error && <div className="login-error">{error}</div>}

        <GoogleButton onSuccess={() => navigate(destination, { replace: true })} onError={setError} />

        <div className="login-divider"><span>or sign up with email</span></div>

        <Field label="Full name">
          <input value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="Email (point of contact)">
          <input type="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Discord username (point of contact)">
          <input value={form.discord} onChange={set('discord')} required />
        </Field>
        <Field label="Password (min 6 characters)">
          <input type="password" value={form.password} onChange={set('password')} minLength={6} required />
        </Field>
        <Field label="Resume / CV link (recommended)">
          <input value={form.resumeUrl} onChange={set('resumeUrl')} placeholder="https://drive.google.com/… — helps us assign your role" />
        </Field>
        <p className="login-hint" style={{ marginTop: 0 }}>New accounts are reviewed by an auditor who assigns your role before you get access.</p>

        <Button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>

        <div className="login-hint">
          Already have an account? <Link to={`/login${authQuery}`}>Sign in</Link>
        </div>
      </form>
    </div>
  );
}
