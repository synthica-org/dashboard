import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon, { BrandMark } from '../components/Icon.jsx';

const TYPE_LABEL = {
  associate: 'Associate Researcher',
  independent: 'Independent Researcher',
  lead: 'Lead Researcher',
  chapter: 'Chapter Leader',
};

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

  return (
    <div className="pv-wrap">
      <div className="pv-head">
        <Link to="/" className="topbar-brand"><BrandMark size={24} />Synthica</Link>
        <div>
          <h1 className="pv-title">Verify a certificate</h1>
          <p className="pv-sub">Confirm a Synthica certificate is genuine by its verification code.</p>
        </div>
      </div>

      <div className="pv-card">
        <form onSubmit={submit}>
          <label className="pp-label" htmlFor="pv-code" style={{ display: 'block' }}>Verification code</label>
          <input
            id="pv-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="SYN-XXXX-XXXX"
            style={{ width: '100%' }}
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()} style={{ width: '100%', marginTop: '0.75rem' }}>
            {busy ? 'Checking…' : 'Verify certificate'}
          </button>
        </form>

        {result && (
          <div className="pv-result" role="status">
            {result.valid ? (
              <>
                <span className="guide-ico guide-ico-success" aria-hidden="true">
                  <Icon name="check-circle" size={17} />
                </span>
                <div>
                  <strong>Genuine certificate</strong>
                  <p>Issued to <strong>{result.name}</strong></p>
                  <p>
                    {TYPE_LABEL[result.type] || result.type}
                    {result.issuedAt && <> · {new Date(result.issuedAt).toLocaleDateString()}</>}
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="guide-ico guide-ico-danger" aria-hidden="true">
                  <Icon name="alert" size={17} />
                </span>
                <div>
                  <strong>No match found</strong>
                  <p>We couldn’t find a certificate with that code. Double-check it and try again.</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <p className="pv-foot"><Link to="/">← Back to Synthica</Link></p>
    </div>
  );
}
