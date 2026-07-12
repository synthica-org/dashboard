import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';

// Public certificate verification — no login required. A code can be typed in,
// or passed via ?code=SYN-XXXX-XXXX so a certificate's "Verify" link resolves
// straight to an answer. This is the in-app home for the codes printed on every
// Synthica role certificate.
export default function VerifyCertificate() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get('code') || '');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.verifyCertificate(trimmed));
    } catch {
      setResult({ valid: false });
    } finally {
      setBusy(false);
    }
  };

  // Auto-verify when arriving with a ?code= in the URL.
  useEffect(() => {
    const fromUrl = params.get('code');
    if (fromUrl) run(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setParams({ code: code.trim() }, { replace: true });
    run(code);
  };

  const TYPE_LABEL = {
    associate: 'Associate Researcher',
    independent: 'Independent Researcher',
    lead: 'Lead Researcher',
    chapter: 'Chapter Leader',
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <Link to="/" className="topbar-brand" style={{ justifyContent: 'center', marginBottom: '0.75rem' }}>
          <img className="brand-img" src={`${import.meta.env.BASE_URL}assets/logo/logo.png`} alt="" />Synthica
        </Link>
        <h1>Verify a <span className="yellow-text">certificate</span></h1>
        <p className="sub">Confirm a Synthica certificate is genuine by its verification code.</p>

        <form onSubmit={submit} style={{ marginTop: '1rem' }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SYN-XXXX-XXXX"
            aria-label="Certificate verification code"
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()} style={{ width: '100%', marginTop: '0.6rem' }}>
            {busy ? 'Checking…' : 'Verify certificate'}
          </button>
        </form>

        {result && (
          <div className="info-block" style={{ marginTop: '1rem', textAlign: 'left' }}>
            {result.valid ? (
              <>
                <span className="guide-ico guide-ico-success" aria-hidden="true" style={{ marginBottom: '0.35rem' }}>
                  <Icon name="check-circle" size={19} />
                </span>
                <strong style={{ display: 'block', fontSize: '1.05rem' }}>Genuine certificate</strong>
                <p style={{ margin: '0.4rem 0 0' }}>
                  Issued to <strong>{result.name}</strong>
                </p>
                <p className="muted" style={{ margin: '0.15rem 0 0' }}>
                  {TYPE_LABEL[result.type] || result.type}
                  {result.issuedAt && <> · {new Date(result.issuedAt).toLocaleDateString()}</>}
                </p>
              </>
            ) : (
              <>
                <span className="guide-ico guide-ico-danger" aria-hidden="true" style={{ marginBottom: '0.35rem' }}>
                  <Icon name="alert" size={19} />
                </span>
                <strong style={{ display: 'block', fontSize: '1.05rem' }}>No match found</strong>
                <p className="muted" style={{ margin: '0.4rem 0 0' }}>
                  We couldn’t find a certificate with that code. Double-check it and try again.
                </p>
              </>
            )}
          </div>
        )}

        <p className="home-link" style={{ marginTop: '1.25rem' }}>
          <Link to="/">← Back to Synthica</Link>
        </p>
      </div>
    </div>
  );
}
