import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { Card, Button, Field } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';

// Send direct emails to researchers or all members
export default function Email() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [f, setF] = useState({ to: '', subject: '', heading: '', body: '', audience: 'researchers' });
  const [busy, setBusy] = useState(false);
  const [customEmail, setCustomEmail] = useState('');

  useEffect(() => { api.config().then(setCfg).catch(() => {}); }, []);

  const send = async (e) => {
    e.preventDefault();
    if (!f.subject || !f.body) {
      toast.error('Subject and body are required');
      return;
    }
    if (f.audience === 'custom' && !customEmail) {
      toast.error('Please enter a custom email address');
      return;
    }
    setBusy(true);
    try {
      const payload = { ...f };
      if (f.audience === 'custom') {
        payload.to = customEmail;
      }
      const r = await api.adminBroadcast(payload);
      toast.success(`Email sent to ${r.sent} recipient${r.sent !== 1 ? 's' : ''}`);
      setF({ ...f, subject: '', heading: '', body: '' });
      setCustomEmail('');
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <h1 className="page-title">Send Email</h1>
      <p className="page-sub">Send direct emails to researchers, all members, or a specific email address.</p>

      <Card>
        {cfg && cfg.emailConfigured === false && (
          <p className="callout-warn" style={{ marginTop: 0 }}>
            <Icon name="alert" size={15} /> <span>Email delivery isn't configured — emails will be logged only.</span>
          </p>
        )}
        <form onSubmit={send}>
          <Field label="Send to">
            <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
              <option value="researchers">Researchers only</option>
              <option value="all">All members</option>
              <option value="custom">Specific email address</option>
            </select>
          </Field>
          {f.audience === 'custom' && (
            <Field label="Email address(es)">
              <input
                type="text"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                required
                placeholder="email1@example.com, email2@example.com, ..."
              />
              <span className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem', display: 'block' }}>Separate multiple emails with commas</span>
            </Field>
          )}
          <Field label="Subject">
            <input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required placeholder="Email subject line" />
          </Field>
          <Field label="Heading (optional — defaults to subject)">
            <input value={f.heading} onChange={(e) => setF({ ...f, heading: e.target.value })} placeholder="Email heading" />
          </Field>
          <Field label="Message">
            <textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required placeholder="Write your message here..." />
          </Field>
          <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send Email'}</Button>
          <span className="muted" style={{ marginLeft: '0.6rem', fontSize: '0.8rem' }}>Sent from notification@synthica.org</span>
        </form>
      </Card>
    </div>
  );
}
