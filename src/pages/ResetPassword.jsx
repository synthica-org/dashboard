import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Field } from '../components/ui.jsx';

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
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Reset <span className="yellow-text">password</span></h1>
        {done ? (
          <>
            <p className="sub">Password updated — you can sign in now.</p>
            <Button onClick={() => navigate('/login')} style={{ width: '100%' }}>Go to login</Button>
          </>
        ) : (
          <>
            {err && <div className="login-error">{err}</div>}
            <Field label="New password (min 6 characters)">
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} required />
            </Field>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Saving…' : 'Set new password'}</Button>
            <div className="login-hint"><Link to="/login">Back to login</Link></div>
          </>
        )}
      </form>
    </div>
  );
}
