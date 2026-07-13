import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import UploadButton from '../../components/UploadButton.jsx';
import { imageSrc } from '../../files.js';

const CATS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

// Research Groups directory (/researcher/groups). A research group is a branded
// hub that bundles several projects, a member roster, open positions, and shared
// resources under one identity. Lead Researchers create them; any member can
// browse and join. See ROLE_WORKFLOWS.md §5.5.
export default function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const isLead = (user?.tags || []).includes('lead_researcher');
  const toast = useToast();

  const load = useCallback(() => api.groups().then(setGroups).catch(() => setGroups([])), []);
  useEffect(() => { load(); }, [load]);

  // Only offer category filters that actually have groups behind them.
  const categories = useMemo(
    () => Array.from(new Set((groups || []).map((g) => g.category).filter(Boolean))).sort(),
    [groups],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (groups || []).filter((g) => {
      if (cat && g.category !== cat) return false;
      if (needle && !`${g.name} ${g.description || ''} ${g.leaderName || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [groups, cat, q]);

  if (!groups) return <div className="page-loading">Loading…</div>;

  const showFilters = categories.length > 0 || groups.length > 3;

  return (
    <div>
      <div className="card-row" style={{ marginBottom: '0.3rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>Research Groups</h1>
        {isLead && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ New group'}</Button>}
      </div>
      <p className="page-sub" style={{ maxWidth: 680 }}>
        Branded hubs where a Lead Researcher gathers related projects, an open team, and shared
        resources. Browse a group, then <strong>join</strong> to follow its work and apply for its
        open positions — no project membership required.
      </p>

      {showCreate && <CreateGroup onDone={(g) => { setShowCreate(false); load(); if (g?.id) toast.success('Group created'); }} toast={toast} />}

      {groups.length === 0 ? (
        <EmptyState>
          No research groups yet.{isLead ? ' Create the first one to bring your projects together.' : ' Check back soon — Lead Researchers create these.'}
        </EmptyState>
      ) : (
        <>
          {showFilters && (
            <div className="card-row" style={{ gap: '0.6rem', margin: '0.2rem 0 1rem', flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: '0.35rem', flexWrap: 'wrap' }}>
                <FilterChip active={cat === ''} onClick={() => setCat('')}>All</FilterChip>
                {categories.map((c) => (
                  <FilterChip key={c} active={cat === c} onClick={() => setCat(cat === c ? '' : c)}>{c}</FilterChip>
                ))}
              </div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search groups…"
                aria-label="Search groups"
                style={{ maxWidth: 220 }}
              />
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState>
              No groups match your filters.{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCat(''); setQ(''); }} style={{ marginLeft: '0.4rem' }}>Clear filters</button>
            </EmptyState>
          ) : (
            <div className="grid grid-3">
              {visible.map((g) => <GroupCard key={g.id} g={g} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// A pill toggle used for the category filter row.
function FilterChip({ active, onClick, children }) {
  return (
    <Button variant={active ? 'primary' : 'ghost'} size="btn-sm" onClick={onClick} aria-pressed={active}>
      {children}
    </Button>
  );
}

// A single directory tile: banner, logo, name, category, and at-a-glance counts.
function GroupCard({ g }) {
  return (
    <Link to={`/researcher/groups/${g.id}`} className="card group-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      {g.bannerUrl
        ? <img className="group-card-banner" src={imageSrc(g.bannerUrl)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <div className="group-card-banner banner-ph" aria-hidden="true" />}
      <div className="row" style={{ gap: '0.6rem', alignItems: 'center', marginBottom: '0.35rem' }}>
        {g.logoUrl && <img className="group-logo" src={imageSrc(g.logoUrl)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        <h3 style={{ margin: 0 }}>{g.name}</h3>
      </div>
      <div className="row" style={{ gap: '0.3rem', marginBottom: '0.45rem', flexWrap: 'wrap' }}>
        {g.category && <Badge tone="gray">{g.category}</Badge>}
        <Badge tone="blue">{g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}</Badge>
        <Badge tone="green">{g.projectCount} {g.projectCount === 1 ? 'project' : 'projects'}</Badge>
      </div>
      {g.description
        ? <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{g.description.slice(0, 120)}{g.description.length > 120 ? '…' : ''}</p>
        : <p className="muted" style={{ margin: 0, fontSize: '0.85rem', fontStyle: 'italic' }}>No description yet.</p>}
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.6rem' }}>Led by {g.leaderName}</p>
    </Link>
  );
}

function CreateGroup({ onDone, toast }) {
  const [form, setForm] = useState({ name: '', category: '', description: '', bannerUrl: '', logoUrl: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const g = await api.createGroup(form); onDone(g); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Card className="pop-in" style={{ marginBottom: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Start a research group</h3>
      <p className="muted" style={{ marginTop: '-0.3rem', fontSize: '0.85rem' }}>
        Give it an identity now — add projects, positions, and links from the group page afterwards.
      </p>
      <form onSubmit={submit}>
        <Field label="Group name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Synthica Genomics Collective" /></Field>
        <Field label="Primary interest / category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">— pick one —</option>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Description"><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this group work on, and who is it for?" /></Field>
        <GroupArtFields form={form} setForm={setForm} />
        <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</Button>
      </form>
    </Card>
  );
}

// Shared banner + logo pickers (paste a URL or upload), with live previews.
export function GroupArtFields({ form, setForm }) {
  return (
    <>
      <Field label="Banner image (wide — shows across the top)">
        <div className="row" style={{ gap: '0.4rem' }}>
          <input value={form.bannerUrl} onChange={(e) => setForm({ ...form, bannerUrl: e.target.value })} placeholder="https://… or upload →" />
          <UploadButton kind="image" label="Banner" onUploaded={({ url }) => setForm((f) => ({ ...f, bannerUrl: url }))} />
        </div>
      </Field>
      {form.bannerUrl && <img src={imageSrc(form.bannerUrl)} alt="Banner preview" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 12, margin: '0 0 0.6rem', border: '1px solid var(--border)' }} />}
      <Field label="Logo (square — shows beside the name)">
        <div className="row" style={{ gap: '0.4rem' }}>
          <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://… or upload →" />
          <UploadButton kind="image" label="Logo" onUploaded={({ url }) => setForm((f) => ({ ...f, logoUrl: url }))} />
        </div>
      </Field>
      {form.logoUrl && <img src={imageSrc(form.logoUrl)} alt="Logo preview" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 12, margin: '0 0 0.6rem', border: '1px solid var(--border)' }} />}
    </>
  );
}
