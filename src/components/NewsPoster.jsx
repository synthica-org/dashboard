import { useState } from 'react';
import { api } from '../api.js';
import { Card, Button, Field } from './ui.jsx';
import { useToast } from './toast.jsx';

const AUDIENCES = [
  ['all', 'Everyone'],
  ['researchers', 'Researchers'],
  ['editors', 'Editors / staff'],
];

// Compose a global announcement. Render only for senior editors and up.
export default function NewsPoster({ onPosted }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', bannerUrl: '' });
  const [busy, setBusy] = useState(false);

  const post = async () => {
    setBusy(true);
    try {
      await api.postNews(form);
      setForm({ title: '', body: '', audience: 'all', bannerUrl: '' });
      setOpen(false);
      toast.success('Announcement posted');
      onPosted?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="ghost" className="btn-sm" style={{ marginBottom: '1.5rem' }} onClick={() => setOpen(true)}>
        + Post announcement
      </Button>
    );
  }
  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <h3>Post an announcement</h3>
      <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. New Partnership: Synthica x ColdMatch AI" /></Field>
      <Field label="Message"><textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Write the announcement…" /></Field>
      <div className="row" style={{ gap: '0.6rem' }}>
        <Field label="Audience">
          <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
            {AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Banner image URL (optional)">
          <input value={form.bannerUrl} onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })} placeholder="https://… image" />
        </Field>
      </div>
      <div className="row">
        <Button className="btn-sm" disabled={busy || !form.title.trim() || !form.body.trim()} onClick={post}>Post</Button>
        <Button variant="ghost" className="btn-sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </Card>
  );
}
