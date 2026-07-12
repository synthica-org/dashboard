import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Badge, Button, Field, Pfp } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import { safeHref } from '../../url.js';
import { imageSrc, fileMeta } from '../../files.js';
import { GroupArtFields } from './Groups.jsx';

const CATS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

// Full research-group page (/researcher/groups/:id). Shows the group's branding
// and identity, its open positions, shared links, the member roster, and the
// projects that belong to it. The founding Lead Researcher gets inline
// management for every section; everyone else can join/leave. See §5.5.
export default function GroupDetail() {
  const { id } = useParams();
  const [g, setG] = useState(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  const load = useCallback(() => api.group(id).then(setG).catch(() => setMissing(true)), [id]);
  useEffect(() => { setG(null); setMissing(false); setEditing(false); load(); }, [load]);

  const run = (promise, msg) => promise.then((d) => { setG(d); if (msg) toast.success(msg); }).catch((e) => toast.error(e.message));

  if (missing) {
    return (
      <div>
        <h1 className="page-title">Group not found</h1>
        <p className="muted">This research group may have been removed.</p>
        <Link to="/researcher/groups">← All groups</Link>
      </div>
    );
  }
  if (!g) return <div className="page-loading">Loading…</div>;

  const openCount = g.positions.filter((p) => !p.filledBy).length;

  return (
    <div>
      <Link to="/researcher/groups" className="muted" style={{ fontSize: '0.85rem' }}>← All groups</Link>

      {g.bannerUrl
        ? <img className="group-banner pop-in" src={imageSrc(g.bannerUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <div className="group-banner pop-in" style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))', border: 'none' }} aria-hidden="true" />}

      <div className="card-row" style={{ margin: '0.6rem 0 0.2rem', alignItems: 'center' }}>
        <div className="row" style={{ gap: '0.7rem', alignItems: 'center', minWidth: 0 }}>
          {g.logoUrl && <img className="group-logo group-logo-lg" src={imageSrc(g.logoUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
          <h1 className="page-title" style={{ margin: 0 }}>{g.name}</h1>
        </div>
        <div className="row" style={{ gap: '0.4rem', flexShrink: 0 }}>
          {g.isLeader && (
            <Button variant="ghost" size="btn-sm" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done editing' : 'Customize'}
            </Button>
          )}
          {g.isLeader
            ? <Badge tone="gold">you lead this</Badge>
            : g.isMember
              ? <Button variant="ghost" onClick={() => run(api.leaveGroup(id), 'Left the group')}>Leave group</Button>
              : <Button onClick={() => run(api.joinGroup(id), 'Joined the group')}>Join group</Button>}
        </div>
      </div>

      <div className="row" style={{ gap: '0.3rem', marginBottom: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {g.category && <Badge tone="gray">{g.category}</Badge>}
        <Badge tone="blue">{g.members.length} {g.members.length === 1 ? 'member' : 'members'}</Badge>
        <Badge tone="green">{g.projects.length} {g.projects.length === 1 ? 'project' : 'projects'}</Badge>
        {openCount > 0 && <Badge tone="gold">{openCount} open {openCount === 1 ? 'position' : 'positions'}</Badge>}
        <span className="muted" style={{ fontSize: '0.82rem' }}>Led by {g.leaderName}</span>
      </div>

      {g.isLeader && editing && (
        <CustomizeGroup group={g} onSaved={(d) => { setG(d); setEditing(false); toast.success('Group updated'); }} toast={toast} />
      )}

      {/* What a group is + how to join — shown to non-members so the page explains itself. */}
      {!g.isMember && !g.isLeader && (
        <Card className="info-block" style={{ marginBottom: '1rem' }}>
          <strong>New here?</strong> A research group bundles related projects under one identity.
          Join to follow its work, appear on the roster, and become eligible for its open positions —
          you don't need to be on any of its projects.
        </Card>
      )}

      {g.description && <p style={{ maxWidth: 720 }}>{g.description}</p>}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: '1rem' }}>
          <PositionsCard g={g} id={id} run={run} setG={setG} toast={toast} openCount={openCount} />
          <ProjectsCard g={g} id={id} run={run} setG={setG} toast={toast} />
        </div>

        <div className="stack" style={{ gap: '1rem' }}>
          <MembersCard g={g} />
          <LinksCard g={g} id={id} run={run} setG={setG} toast={toast} />
        </div>
      </div>
    </div>
  );
}

// ---- Open positions: the group's recruitment board. ----
function PositionsCard({ g, id, run, setG, toast, openCount }) {
  return (
    <Card>
      <div className="card-row">
        <h3 style={{ marginTop: 0, marginBottom: 0 }}>Open positions</h3>
        {g.positions.length > 0 && <Badge tone={openCount > 0 ? 'gold' : 'gray'}>{openCount} open</Badge>}
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0.6rem' }}>
        Roles the group is recruiting for{g.isLeader ? '. Assign a member once they join.' : ' — join the group, then ask the leader to fill you in.'}
      </p>
      <div className="stack">
        {g.positions.length === 0 && <p className="muted">No positions yet.</p>}
        {g.positions.map((pos) => (
          <div key={pos.id} className="info-block" style={{ marginBottom: 0 }}>
            <div className="card-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <strong>{pos.title}</strong>{' '}
                {pos.filledByName ? <Badge tone="green">{pos.filledByName}</Badge> : <Badge tone="gold">open</Badge>}
                {pos.description && <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>{pos.description}</div>}
              </div>
              {g.isLeader && (
                <div className="row" style={{ gap: '0.3rem', flexShrink: 0 }}>
                  <select
                    aria-label={`Assign ${pos.title}`}
                    value={pos.filledBy || ''}
                    onChange={(e) => run(api.fillGroupPosition(id, pos.id, e.target.value || null))}
                    style={{ width: 'auto' }}
                  >
                    <option value="">— open —</option>
                    {g.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button className="btn btn-ghost btn-sm" aria-label={`Remove ${pos.title}`} title="Remove position" onClick={() => run(api.removeGroupPosition(id, pos.id))}>×</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {g.isLeader && <AddPosition groupId={id} onChange={(d) => setG(d)} toast={toast} />}
    </Card>
  );
}

// ---- Projects that belong to the group. ----
function ProjectsCard({ g, id, run, setG, toast }) {
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Projects <Badge tone="gray">{g.projects.length}</Badge></h3>
      <div className="stack">
        {g.projects.length === 0 && <p className="muted">No projects in this group yet.</p>}
        {g.projects.map((p) => (
          <div key={p.id} className="card-row info-block" style={{ marginBottom: 0 }}>
            <div style={{ minWidth: 0 }}>
              <Link to={`/researcher/project/${p.id}`}><strong>{p.title}</strong></Link>{' '}
              {p.category && <Badge tone="gray">{p.category}</Badge>}{' '}
              <span className="muted" style={{ fontSize: '0.78rem' }}>· {p.memberCount} {p.memberCount === 1 ? 'member' : 'members'}</span>
            </div>
            {g.isLeader && (
              <button className="btn btn-ghost btn-sm" onClick={() => run(api.removeGroupProject(id, p.id))}>Remove</button>
            )}
          </div>
        ))}
      </div>
      {g.isLeader && (
        g.addableProjects.length > 0
          ? <AddProject group={g} onChange={(d) => setG(d)} toast={toast} />
          : g.projects.length === 0 && <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>Create a project you lead, then add it here.</p>
      )}
    </Card>
  );
}

// ---- Member roster (group-scoped). ----
function MembersCard({ g }) {
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Members <Badge tone="gray">{g.members.length}</Badge></h3>
      <div className="stack">
        {g.members.map((m) => (
          <div key={m.id} className="row" style={{ gap: '0.55rem' }}>
            <Pfp name={m.name} url={imageSrc(m.avatarUrl)} size="xs" />
            <div style={{ minWidth: 0 }}>
              <Link to={`/p/${m.slug || m.id}`}>{m.name}</Link> {m.isLeader && <Badge tone="gold">leader</Badge>}
              <div className="muted" style={{ fontSize: '0.76rem' }}>{m.role}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---- Shared links & resources. ----
function LinksCard({ g, id, run, setG, toast }) {
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Shared links &amp; resources</h3>
      <div className="stack">
        {g.links.length === 0 && <p className="muted">No links yet.{g.isLeader ? ' Add a repo, drive, or reading list below.' : ''}</p>}
        {g.links.map((l) => {
          const href = safeHref(l.url);
          const meta = fileMeta(l.url);
          return (
            <div key={l.id} className="card-row" style={{ gap: '0.5rem' }}>
              <span className="row" style={{ gap: '0.45rem', minWidth: 0 }}>
                <Badge tone="gray">{meta.kind}</Badge>
                {href ? <a href={href} target="_blank" rel="noreferrer">{l.label}</a> : <span>{l.label}</span>}
              </span>
              {g.isLeader && (
                <button className="btn btn-ghost btn-sm" aria-label={`Remove ${l.label}`} title="Remove link" onClick={() => run(api.removeGroupLink(id, l.id))}>×</button>
              )}
            </div>
          );
        })}
      </div>
      {g.isLeader && <AddLink groupId={id} onChange={(d) => setG(d)} toast={toast} />}
    </Card>
  );
}

// Leader-only panel to edit the group's identity + banner + logo.
function CustomizeGroup({ group, onSaved, toast }) {
  const [form, setForm] = useState({
    name: group.name || '', category: group.category || '', description: group.description || '',
    bannerUrl: group.bannerUrl || '', logoUrl: group.logoUrl || '',
  });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const d = await api.updateGroup(group.id, form); onSaved(d); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <Card className="pop-in" style={{ marginBottom: '0.8rem' }}>
      <h3 style={{ marginTop: 0 }}>Customize group</h3>
      <form onSubmit={save}>
        <Field label="Group name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Primary interest / category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">— pick one —</option>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Description"><textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <GroupArtFields form={form} setForm={setForm} />
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
      </form>
    </Card>
  );
}

function AddProject({ group, onChange, toast }) {
  const [pid, setPid] = useState('');
  const add = () => { if (pid) api.addGroupProject(group.id, pid).then((d) => { onChange(d); setPid(''); }).catch((e) => toast.error(e.message)); };
  return (
    <div className="row" style={{ marginTop: '0.6rem' }}>
      <select value={pid} onChange={(e) => setPid(e.target.value)} style={{ width: 'auto' }} aria-label="Add a project you lead">
        <option value="">+ add one of your projects…</option>
        {group.addableProjects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      <Button size="btn-sm" onClick={add} disabled={!pid}>Add</Button>
    </div>
  );
}

function AddPosition({ groupId, onChange, toast }) {
  const [form, setForm] = useState({ title: '', description: '' });
  const add = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    api.addGroupPosition(groupId, form).then((d) => { onChange(d); setForm({ title: '', description: '' }); }).catch((er) => toast.error(er.message));
  };
  return (
    <form onSubmit={add} className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap' }}>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Position (e.g. Data Lead)" style={{ maxWidth: 200 }} aria-label="Position title" />
      <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What they do (optional)" aria-label="Position description" />
      <Button size="btn-sm" type="submit">Add</Button>
    </form>
  );
}

function AddLink({ groupId, onChange, toast }) {
  const [form, setForm] = useState({ label: '', url: '' });
  const add = (e) => {
    e.preventDefault();
    if (!form.url.trim()) return;
    api.addGroupLink(groupId, form).then((d) => { onChange(d); setForm({ label: '', url: '' }); }).catch((er) => toast.error(er.message));
  };
  return (
    <form onSubmit={add} className="row" style={{ marginTop: '0.6rem', flexWrap: 'wrap' }}>
      <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Label" style={{ maxWidth: 140 }} aria-label="Link label" />
      <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" aria-label="Link URL" />
      <Button size="btn-sm" type="submit">Add</Button>
    </form>
  );
}
