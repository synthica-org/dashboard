import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Button, Pfp, EmptyState } from './ui.jsx';
import { useToast } from './toast.jsx';
import { imageSrc } from '../files.js';

// Privacy & safety controls: manage blocked members, export your data, and
// delete your account. Bundled into the Account area.
export default function PrivacySafety() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [blocks, setBlocks] = useState(null);

  const loadBlocks = useCallback(() => api.myBlocks().then(setBlocks).catch(() => setBlocks([])), []);
  useEffect(() => { loadBlocks(); }, [loadBlocks]);

  const unblock = (id, name) =>
    api.unblockUser(id).then(() => { toast.success(`Unblocked ${name}`); loadBlocks(); }).catch((e) => toast.error(e.message));

  const exportData = async () => {
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `synthica-data-${(user?.username || 'me')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Your data is downloading');
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="stack" style={{ gap: '1.25rem', maxWidth: 720 }}>
      <Card>
        <h3 style={{ marginTop: 0 }}>Blocked members</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          You won’t see posts, comments, or messages from anyone you block, and they can’t message you.
        </p>
        {!blocks ? (
          <p className="muted">Loading…</p>
        ) : blocks.length === 0 ? (
          <EmptyState>You haven’t blocked anyone.</EmptyState>
        ) : (
          <div className="stack">
            {blocks.map((b) => (
              <div key={b.id} className="card-row">
                <div className="row" style={{ alignItems: 'center' }}>
                  <Pfp name={b.name} url={imageSrc(b.avatarUrl)} size="xs" />
                  <Link to={`/p/${b.slug || b.id}`} style={{ fontWeight: 600 }}>{b.name}</Link>
                </div>
                <Button variant="ghost" className="btn-sm" onClick={() => unblock(b.id, b.name)}>Unblock</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>Export your data</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Download a copy of your profile, posts, comments, messages, groups, applications, and certificates as JSON.
        </p>
        <Button variant="ghost" onClick={exportData}>⬇ Download my data</Button>
      </Card>

      {user?.kind !== 'editor' && <DangerZone onDeleted={logout} />}
    </div>
  );
}

function DangerZone({ onDeleted }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const del = async () => {
    if (confirm !== 'DELETE') return;
    setBusy(true);
    try {
      await api.deleteMyAccount();
      toast.success('Your account has been deleted');
      onDeleted?.(); // clears the session → bounces to login
    } catch (e) { toast.error(e.message); setBusy(false); }
  };

  return (
    <Card className="danger-zone">
      <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>Delete account</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Permanently deletes your account and the content tied to it (posts, comments, messages).
        Groups and projects you lead are handed to another member or disbanded. <strong>This can’t be undone.</strong>
      </p>
      <p style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>Type <strong>DELETE</strong> to confirm:</p>
      <div className="row">
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" style={{ maxWidth: 200 }} />
        <Button variant="reject" disabled={busy || confirm !== 'DELETE'} onClick={del}>{busy ? 'Deleting…' : 'Delete my account'}</Button>
      </div>
    </Card>
  );
}
