import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Button, EmptyState } from './ui.jsx';
import { useToast } from './toast.jsx';

// Your personal referral link + how many people you've brought in. The link
// carries ?ref=CODE to /register, which credits you on signup.
export default function Referrals() {
  const [data, setData] = useState(null);
  const toast = useToast();
  useEffect(() => { api.myReferrals().then(setData).catch(() => setData({ code: '', count: 0, referred: [] })); }, []);

  if (!data) return <div className="page-loading">Loading…</div>;
  const link = `${window.location.origin}/register?ref=${encodeURIComponent(data.code)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success('Referral link copied'); }
    catch { toast.error(link); }
  };

  return (
    <Card>
      <h2 className="section-title" style={{ marginBottom: '0.4rem' }}>Refer &amp; invite</h2>
      <p className="login-hint" style={{ marginTop: 0 }}>
        Share your link — when someone joins through it, you get the credit. The more people you bring in, the better.
      </p>

      <div className="info-block" style={{ marginBottom: '1rem' }}>
        <div className="field-label">Your referral link</div>
        <div className="row">
          <input readOnly value={link} onClick={(e) => e.target.select()} />
          <Button className="btn-sm" onClick={copy}>Copy</Button>
        </div>
        <p className="muted" style={{ margin: '0.5rem 0 0' }}>Code: <code>{data.code}</code></p>
      </div>

      <div className="row" style={{ gap: '1.5rem', marginBottom: '0.8rem' }}>
        <div><div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--brand-deep)' }}>{data.count}</div><div className="muted">people referred</div></div>
      </div>

      <h3>Who you've brought in</h3>
      {data.referred.length === 0
        ? <EmptyState>No referrals yet — share your link to get started.</EmptyState>
        : (
          <div className="stack">
            {data.referred.map((r, i) => (
              <div key={i} className="card-row info-block">
                <strong>{r.name}</strong>
                {r.at && <span className="muted" style={{ fontSize: '0.8rem' }}>{new Date(r.at).toLocaleDateString()}</span>}
              </div>
            ))}
          </div>
        )}
    </Card>
  );
}
