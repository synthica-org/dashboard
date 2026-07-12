import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Button, Field, Badge } from '../components/ui.jsx';
import { useToast } from '../components/toast.jsx';
import UploadButton from '../components/UploadButton.jsx';

// "Résumé & tools" — the researcher's résumé (used to auto-apply to listings),
// editor activity stats, and a few scaffolded resources. Account-level security
// (2FA) lives in the separate <Security /> tab, exported below.
export default function Tools() {
  const { user } = useAuth();
  return (
    <div>
      {user.kind === 'editor' && <EditorStats />}
      {user.kind === 'researcher' && <ResumeCard user={user} />}

      <h2 className="section-title" style={{ margin: '0.25rem 0 0.75rem' }}>Resources</h2>
      <div className="grid grid-3">
        <Placeholder title="Templates" desc="Proposal, methods, and review templates to reuse." />
        <Placeholder title="Branding" desc="Logos, colors, and slide decks." />
        <Placeholder title="Guides" desc="Onboarding docs and how-tos." />
      </div>
    </div>
  );
}

// Two-factor authentication enrollment + account security. Its own Account tab.
export function Security() {
  const { user } = useAuth();
  return (
    <div className="stack" style={{ gap: '1.25rem', maxWidth: 720 }}>
      <SecurityCard user={user} />
      <Card>
        <h3 style={{ marginTop: 0 }}>Password</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Forgot your password or want to change it? Use the reset link — we’ll email you a secure link to set a new one.
        </p>
        <a className="btn btn-ghost btn-sm" href="/forgot">Send a password reset link</a>
      </Card>
    </div>
  );
}

function SecurityCard({ user }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(user.twoFactorEnabled);
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setError('');
    setBusy(true);
    try { setSetup(await api.setup2fa()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const enable = async () => {
    setError('');
    setBusy(true);
    try { await api.enable2fa(code); setEnabled(true); setSetup(null); setCode(''); toast.success('Two-factor enabled'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const disable = async () => {
    setError('');
    setBusy(true);
    try { await api.disable2fa(code); setEnabled(false); setCode(''); toast.success('Two-factor disabled'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="card-row">
        <h3 style={{ margin: 0 }}>Two-factor authentication</h3>
        <Badge tone={enabled ? 'green' : 'gray'}>{enabled ? 'on' : 'off'}</Badge>
      </div>
      <p className="muted" style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.85rem' }}>
        Add a second step at sign-in with a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy).
        Strongly recommended — especially for editors and chapter leaders.
      </p>
      {error && <div className="login-error">{error}</div>}

      {enabled ? (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>Enter a current code from your authenticator to turn 2FA off.</p>
          <div className="row">
            <input placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" style={{ maxWidth: 160 }} />
            <Button variant="reject" disabled={busy || code.length < 6} onClick={disable}>{busy ? 'Disabling…' : 'Disable'}</Button>
          </div>
        </>
      ) : setup ? (
        <div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>1. Scan this QR code with your authenticator app. 2. Enter the code it shows to confirm.</p>
          <img
            alt="Scan this QR code with your authenticator app"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(setup.otpauthUrl)}`}
            width={160}
            height={160}
            style={{ margin: '0.5rem 0', borderRadius: 8, background: '#fff' }}
          />
          <p className="muted" style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>Can’t scan? Enter this key manually: <code>{setup.secret}</code></p>
          <div className="row">
            <input placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" style={{ maxWidth: 160 }} />
            <Button disabled={busy || code.length < 6} onClick={enable}>{busy ? 'Enabling…' : 'Enable'}</Button>
            <Button variant="ghost" onClick={() => { setSetup(null); setCode(''); setError(''); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button onClick={begin} disabled={busy}>{busy ? 'Setting up…' : 'Set up 2FA'}</Button>
      )}
    </Card>
  );
}

function EditorStats() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.editorStats().then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  const items = [
    ['Reviewed', s.reviewed],
    ['Approved', s.approved],
    ['Declined', s.declined],
    ['Active now', s.active],
  ];
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>My stats</h2>
      <div className="grid grid-4">
        {items.map(([label, value]) => (
          <Card key={label}>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--ink)' }}>{value}</div>
            <div className="muted">{label}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Placeholder({ title, desc }) {
  return (
    <Card>
      <div className="card-row">
        <h3>{title}</h3>
        <Badge tone="gray">soon</Badge>
      </div>
      <p className="muted" style={{ marginTop: '0.4rem' }}>
        {desc}
      </p>
    </Card>
  );
}

function ResumeCard({ user }) {
  const { refreshUser } = useAuth();
  const [url, setUrl] = useState(user.resumeUrl || '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.updateResume(url);
      // Keep the auth user fresh so listings auto-apply with the new résumé.
      await refreshUser();
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <h3 style={{ marginTop: 0 }}>My résumé</h3>
      <p className="muted" style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.85rem' }}>
        Link your résumé so you can auto-apply to project listings. Update it any time.
      </p>
      {error && <div className="login-error">{error}</div>}
      <Field label="Résumé (upload a PDF or paste a link)">
        <div className="row" style={{ gap: '0.4rem' }}>
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
            placeholder="https://… or upload"
          />
          <UploadButton kind="resume" label="Upload PDF" onUploaded={(r) => { setUrl(r.url); setSaved(false); }} />
        </div>
      </Field>
      <div className="row" style={{ alignItems: 'center' }}>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save résumé'}
        </Button>
        {url && <a className="muted" href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>Preview →</a>}
        {saved && <span className="muted" style={{ fontSize: '0.85rem' }}>Saved ✓</span>}
      </div>
    </Card>
  );
}
