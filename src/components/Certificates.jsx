import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Badge, Button, EmptyState } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useToast } from '../components/toast.jsx';

// Role certificates — one renderer for every Synthica role. Each certificate is
// drawn on a <canvas> over the official template (the same artwork as the
// AssociateResearcher / IndependentResearcher / LeadResearch / ChapterLeader
// generator repos) with the holder's name and a verification code, then offered
// as a PNG download. Anyone can confirm a code at /verify-certificate.

const CERT_META = {
  associate: { label: 'Associate Researcher', template: `${import.meta.env.BASE_URL}assets/certs/associate.jpg`, blurb: 'For contributing to a published research project.' },
  independent: { label: 'Independent Researcher', template: `${import.meta.env.BASE_URL}assets/certs/independent.jpg`, blurb: 'For independently driving a research project.' },
  lead: { label: 'Lead Researcher', template: `${import.meta.env.BASE_URL}assets/certs/lead.jpg`, blurb: 'For leading a team to a publishable result.' },
  chapter: { label: 'Chapter Leader', template: `${import.meta.env.BASE_URL}assets/certs/chapter.jpg`, blurb: 'For founding and running a Synthica chapter.' },
};

const certLabel = (type) => CERT_META[type]?.label || type;
const downloadName = (type, name) => `Synthica ${certLabel(type)} Certificate - ${name}.png`;

async function renderCertificate({ type, name, code }) {
  const meta = CERT_META[type];
  if (!meta) throw new Error('Unknown certificate type');
  const tmpl = new Image();
  tmpl.src = meta.template;
  await new Promise((resolve, reject) => {
    tmpl.onload = resolve;
    tmpl.onerror = () => reject(new Error('Could not load the certificate template'));
  });
  await document.fonts.load('700 100px "Cinzel"').catch(() => {});
  await document.fonts.ready;

  const W = tmpl.naturalWidth;
  const H = tmpl.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(tmpl, 0, 0, W, H);

  // Recipient name sits between "of recognition" and "This person is
  // recognized as:". Auto-shrinks so long names stay inside the slot.
  let size = Math.floor(W * 0.034);
  ctx.font = `700 ${size}px "Cinzel", serif`;
  while (ctx.measureText(name).width > W * 0.6 && size > 20) {
    size -= 2;
    ctx.font = `700 ${size}px "Cinzel", serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c9a84c';
  ctx.fillText(name, W / 2, H * 0.328);

  // Verification code, small, inside the bottom-right of the white card.
  ctx.font = `${Math.floor(W * 0.011)}px "Lato", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9aa0a8';
  ctx.fillText(`Verify: ${code} · synthica.org`, W * 0.915, H * 0.885);

  return canvas.toDataURL('image/png');
}

export default function Certificates() {
  const [data, setData] = useState(null);
  const [busyType, setBusyType] = useState('');
  const [preview, setPreview] = useState(null);
  const toast = useToast();

  useEffect(() => { api.myCertificates().then(setData).catch(() => setData({ eligible: [], issued: [] })); }, []);

  // Generate (or re-fetch) the certificate and show a live preview; downloading
  // is a second click off that preview.
  const generate = async (type) => {
    setBusyType(type);
    try {
      const cert = await api.issueCertificate(type); // idempotent: same code every time
      const url = await renderCertificate({ type, name: cert.name, code: cert.code });
      setPreview({ type, code: cert.code, name: cert.name, url });
      toast.success(`Certificate ready — verification code ${cert.code}`);
      setData(await api.myCertificates());
    } catch (e) { toast.error(e.message); } finally { setBusyType(''); }
  };

  if (!data) return <div className="page-loading">Loading…</div>;
  const issuedFor = (type) => data.issued.find((c) => c.type === type);

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <Card>
        <h2 className="section-title" style={{ marginBottom: '0.4rem' }}>Your certificates</h2>
        <p className="login-hint" style={{ marginTop: 0 }}>
          Official recognition of your Synthica role — great for college apps and résumés.
          Every certificate has a verification code admissions officers can check.
        </p>
        {data.eligible.length === 0 ? (
          <EmptyState>No certificates yet — they unlock when an auditor assigns you a researcher role (Associate, Independent, Lead, or Chapter Leader).</EmptyState>
        ) : (
          <div className="grid grid-3">
            {data.eligible.map((type) => {
              const cert = issuedFor(type);
              const meta = CERT_META[type];
              return (
                <Card key={type}>
                  <h3 className="icon-label" style={{ margin: '0 0 0.25rem' }}>
                    <span className="guide-ico guide-ico-sm" aria-hidden="true"><Icon name="award" size={16} /></span>
                    {certLabel(type)}
                  </h3>
                  <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>{meta?.blurb}</p>
                  {cert
                    ? <p className="login-hint" style={{ margin: '0 0 0.6rem' }}>Issued {new Date(cert.issuedAt).toLocaleDateString()} · code <code>{cert.code}</code></p>
                    : <p className="login-hint" style={{ margin: '0 0 0.6rem' }}>Ready to generate.</p>}
                  <Button disabled={busyType === type} onClick={() => generate(type)}>
                    {busyType === type ? 'Generating…' : cert ? 'Preview & download' : 'Generate'}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: '1.25rem' }}>
            <h3 style={{ margin: '0 0 0.5rem' }}>{certLabel(preview.type)} — preview</h3>
            <img
              src={preview.url}
              alt={`${certLabel(preview.type)} certificate for ${preview.name}`}
              style={{ width: '100%', maxWidth: 640, borderRadius: 'var(--radius-lg)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-md)', display: 'block' }}
            />
            <div className="row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
              <a className="btn btn-primary btn-sm" href={preview.url} download={downloadName(preview.type, preview.name)}>Download PNG</a>
              <span className="login-hint">Verification code <code>{preview.code}</code></span>
            </div>
          </div>
        )}
      </Card>

      <CertificateVerifier />
    </div>
  );
}

// Anyone can paste a code here (or visit /verify-certificate) to confirm a
// certificate is genuine — handy to drop into an application or share with a
// reviewer. Verification is public, so it works even when signed out.
function CertificateVerifier() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async (e) => {
    e.preventDefault();
    const trimmed = code.trim();
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

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Verify a certificate</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Enter a verification code (looks like <code>SYN-XXXX-XXXX</code>) to confirm it’s genuine.
      </p>
      <form className="row" onSubmit={check}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SYN-XXXX-XXXX" style={{ maxWidth: 220 }} />
        <Button type="submit" className="btn-sm" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Verify'}</Button>
        <Link className="muted" to="/verify-certificate" style={{ fontSize: '0.82rem' }}>Open shareable page →</Link>
      </form>
      {result && (
        <div className="info-block" style={{ marginTop: '0.75rem' }}>
          {result.valid ? (
            <>
              <Badge tone="green"><Icon name="check" size={11} /> Valid</Badge>{' '}
              <strong>{result.name}</strong> — {certLabel(result.type)}
              {result.issuedAt && <span className="muted"> · issued {new Date(result.issuedAt).toLocaleDateString()}</span>}
            </>
          ) : (
            <><Badge tone="gray">Not found</Badge> <span className="muted">No certificate matches that code.</span></>
          )}
        </div>
      )}
    </Card>
  );
}
