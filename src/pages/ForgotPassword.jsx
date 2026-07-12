import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Field } from '../components/ui.jsx';
import AuthShell from '../components/AuthShell.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.forgotPassword(email);
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  return (
    <AuthShell>
      <h1>Forgot password</h1>
      {sent ? (
        <p className="sub">If an account exists for that email, a reset link is on its way.</p>
      ) : (
        <>
          <p className="sub">Enter your email and we’ll send a reset link.</p>
          <form onSubmit={submit}>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Sending…' : 'Send reset link'}</Button>
          </form>
        </>
      )}
      <div className="login-hint"><Link to="/login">Back to login</Link></div>
    </AuthShell>
  );
}
