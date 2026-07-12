import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

export default function Verify() {
  const [sp] = useSearchParams();
  const [status, setStatus] = useState('working');
  useEffect(() => {
    const t = sp.get('token');
    if (!t) return setStatus('error');
    api.verifyEmail(t).then(() => setStatus('ok')).catch(() => setStatus('error'));
  }, []); // eslint-disable-line
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Email <span className="yellow-text">verification</span></h1>
        <p className="sub">
          {status === 'working' ? 'Verifying…' : status === 'ok' ? <span className="icon-label"><Icon name="party" size={16} /> Your email is verified!</span> : 'This link is invalid or expired.'}
        </p>
        <Link className="btn btn-primary" to="/login" style={{ width: '100%' }}>Go to login</Link>
      </div>
    </div>
  );
}
