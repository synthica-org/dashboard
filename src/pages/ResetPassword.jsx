import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Field } from '../components/ui.jsx';
import AuthShell from '../components/AuthShell.jsx';

export default function ResetPassword() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.resetPassword(sp.get('token'), pw);
      setDone(true);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1>Reset password</h1>
      {done ? (
        <>
          <p className="sub">Password updated — you can sign in now.</p>
          <Button onClick={() => navigate('/login')} style={{ width: '100%' }}>Go to login</Button>
        </>
      ) : (
        <>
          {err && <div className="login-error">{err}</div>}
          <form onSubmit={submit}>
            <Field label="New password (min 6 characters)">
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} required />
            </Field>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Saving…' : 'Set new password'}</Button>
          </form>
          <div className="login-hint"><Link to="/login">Back to login</Link></div>
        </>
      )}
    </AuthShell>
  );
}
