import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Badge, Button, Pfp, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import { imageSrc } from '../../files.js';
import Icon from '../../components/Icon.jsx';

// Directory + your network (people you follow / who follow you). Follow to get
// their updates in your feed; message anyone directly.
export default function People() {
  const [tab, setTab] = useState('discover');
  const [people, setPeople] = useState(null);
  const [network, setNetwork] = useState(null);
  const [q, setQ] = useState('');
  const toast = useToast();

  const load = useCallback(() => api.people().then(setPeople).catch(() => setPeople([])), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'network' && !network) api.network().then(setNetwork).catch(() => setNetwork({ following: [], followers: [] })); }, [tab, network]);

  // Follow/unfollow optimistically in the directory, and drop the cached network
  // so the My-network tab refetches with the change applied.
  const toggle = (p) => {
    setPeople((cur) => (cur || []).map((x) => (x.id === p.id ? { ...x, following: !x.following } : x)));
    setNetwork(null);
    (p.following ? api.unfollow(p.id) : api.follow(p.id)).catch((e) => {
      toast.error(e.message);
      setPeople((cur) => (cur || []).map((x) => (x.id === p.id ? { ...x, following: p.following } : x)));
    });
  };

  const needle = q.trim().toLowerCase();
  const shown = !people ? [] : !needle ? people : people.filter((p) =>
    p.name.toLowerCase().includes(needle)
    || (p.interests || []).some((i) => i.toLowerCase().includes(needle))
    || p.role.toLowerCase().includes(needle)
    || (p.username || '').toLowerCase().includes(needle)
    || (p.blurb || '').toLowerCase().includes(needle)
    || (p.institution || '').toLowerCase().includes(needle)
  );

  return (
    <div>
      <h1 className="page-title">People</h1>
      <p className="page-sub">Follow researchers and editors to get their updates — and message anyone directly.</p>

      <div className="seg" style={{ marginBottom: '1.25rem' }}>
        <button className={`seg-btn ${tab === 'discover' ? 'active' : ''}`} onClick={() => setTab('discover')}>Discover</button>
        <button className={`seg-btn ${tab === 'network' ? 'active' : ''}`} onClick={() => setTab('network')}>My network</button>
      </div>

      {tab === 'discover' ? (
        !people ? (
          <div className="page-loading">Loading…</div>
        ) : (
          <>
            <input
              placeholder="Search name, @username, role, affiliation, or interest"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 380, marginBottom: '1rem' }}
            />
            {people.length === 0 ? (
              <EmptyState>No members to show yet.</EmptyState>
            ) : shown.length === 0 ? (
              <EmptyState>No one matches “{q}”. Try a different name, role, or interest.</EmptyState>
            ) : (
              <div className="grid grid-3">
                {shown.map((p) => <PersonCard key={p.id} p={p} onToggle={toggle} />)}
              </div>
            )}
          </>
        )
      ) : !network ? (
        <div className="page-loading">Loading…</div>
      ) : (
        <>
          <h3 style={{ marginTop: 0 }}>Following <Badge tone="gray">{network.following.length}</Badge></h3>
          {network.following.length === 0 ? (
            <EmptyState>You're not following anyone yet — find people in <button className="link-btn" onClick={() => setTab('discover')}>Discover</button>.</EmptyState>
          ) : (
            <div className="grid grid-3" style={{ marginBottom: '1.5rem' }}>{network.following.map((p) => <ConnectionCard key={p.id} p={p} />)}</div>
          )}
          <h3>Followers <Badge tone="gray">{network.followers.length}</Badge></h3>
          {network.followers.length === 0 ? (
            <EmptyState>No followers yet — share your profile to grow your network.</EmptyState>
          ) : (
            <div className="grid grid-3">{network.followers.map((p) => <ConnectionCard key={p.id} p={p} />)}</div>
          )}
        </>
      )}
    </div>
  );
}

function PersonCard({ p, onToggle }) {
  return (
    <Card>
      <div className="row">
        <Pfp name={p.name} url={imageSrc(p.avatarUrl)} />
        <div style={{ minWidth: 0 }}>
          <Link to={`/p/${p.slug || p.id}`} style={{ fontWeight: 700 }}>{p.name}</Link>
          <div className="muted" style={{ fontSize: '0.78rem' }}>{p.role}{p.username ? ` · @${p.username}` : ''}</div>
          {p.institution && <div className="muted" style={{ fontSize: '0.78rem' }}>{p.institution}</div>}
        </div>
      </div>
      {p.blurb && <p className="muted" style={{ margin: '0.45rem 0 0', fontSize: '0.85rem' }}>{p.blurb}</p>}
      {p.interests?.length > 0 && (
        <div className="row" style={{ marginTop: '0.4rem', gap: '0.3rem', flexWrap: 'wrap' }}>
          {p.interests.slice(0, 3).map((i) => <Badge key={i} tone="gray">{i}</Badge>)}
        </div>
      )}
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <Button className="btn-sm" variant={p.following ? 'ghost' : 'primary'} onClick={() => onToggle(p)}>{p.following ? <span className="icon-label"><Icon name="check" size={14} /> Following</span> : 'Follow'}</Button>
      </div>
    </Card>
  );
}

function ConnectionCard({ p }) {
  return (
    <Card>
      <div className="row">
        <Pfp name={p.name} url={imageSrc(p.avatarUrl)} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/p/${p.slug || p.id}`} style={{ fontWeight: 700 }}>{p.name}</Link>{p.mutual && <> <Badge tone="blue">mutual</Badge></>}
          <div className="muted" style={{ fontSize: '0.78rem' }}>{p.role}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <Link className="btn btn-ghost btn-sm" to={`/p/${p.slug || p.id}`}>Profile</Link>
      </div>
    </Card>
  );
}
