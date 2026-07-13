import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth, firstNameOf } from '../../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState, Modal } from '../../../components/ui.jsx';
import { useToast } from '../../../components/toast.jsx';

// Dedicated Independent Researcher workspace (ROLE_WORKFLOWS §6).
//   • Hero + role guide
//   • Research proposals: submit → Moderator approval → real project (§6.2)
//   • My projects (the ones approval created)
//   • Pathways: personal checklist from research question → draft (§6.3)
export default function IndependentHome() {
  const { user } = useAuth();
  const [proposals, setProposals] = useState(null);
  const [projects, setProjects] = useState(null);
  const [composing, setComposing] = useState(false);
  const [revising, setRevising] = useState(null); // a rejected proposal being edited

  const loadProposals = useCallback(() => api.myProposals().then(setProposals).catch(() => setProposals([])), []);
  const loadProjects = useCallback(() => api.myProjects().then(setProjects).catch(() => setProjects([])), []);
  useEffect(() => { loadProposals(); loadProjects(); }, [loadProposals, loadProjects]);

  if (!user) return <div className="page-loading">Loading…</div>;

  const pending = (proposals || []).filter((p) => p.status === 'pending').length;
  const approved = (proposals || []).filter((p) => p.status === 'approved').length;

  const onSubmitted = () => { setComposing(false); setRevising(null); loadProposals(); loadProjects(); };

  return (
    <div>
      <DashboardHero
        name={firstNameOf(user.name)}
        pending={pending}
        approved={approved}
        projects={(projects || []).length}
        onAdd={() => { setRevising(null); setComposing(true); }}
      />

      <RoleGuide />

      <Proposals
        proposals={proposals}
        onAdd={() => { setRevising(null); setComposing(true); }}
        onRevise={(p) => { setComposing(false); setRevising(p); }}
      />

      <MyProjects projects={projects} />

      <Pathways />

      {(composing || revising) && (
        <ProposalForm
          existing={revising}
          onClose={() => { setComposing(false); setRevising(null); }}
          onSaved={onSubmitted}
        />
      )}
    </div>
  );
}

// --- hero -------------------------------------------------------------------

function DashboardHero({ name, pending, approved, projects, onAdd }) {
  return (
    <section className="hero-card hero-card--independent" style={{ marginBottom: '1.5rem' }}>
      <div className="card-row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ minWidth: 0 }}>
          <div className="hero-eyebrow">Independent researcher</div>
          <h1 className="page-title" style={{ margin: '0.4rem 0 0.2rem' }}>
            Welcome, {name}
          </h1>
          <p style={{ margin: 0, maxWidth: '46ch' }}>
            Propose and run solo, self-directed projects. Submit a research proposal, get it approved by a moderator, then work through your Pathway from question to draft.
          </p>
        </div>
        <Button className="hero-btn" onClick={onAdd}>+ Add a project</Button>
      </div>
      <div className="row" style={{ gap: 'clamp(1.2rem, 5vw, 3rem)', marginTop: '1.1rem', flexWrap: 'wrap' }}>
        <HeroStat n={pending} label="Pending approval" />
        <HeroStat n={approved} label="Approved" />
        <HeroStat n={projects} label="Active projects" />
      </div>
    </section>
  );
}

function HeroStat({ n, label }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="hero-stat-n">{n}</div>
      <div className="hero-stat-label">{label}</div>
    </div>
  );
}

// --- role guide -------------------------------------------------------------

const GUIDE_STEPS = [
  ['1', 'Propose', 'Write a short research proposal — title, category, description and the methodology you plan to use.'],
  ['2', 'Get approved', 'A moderator reviews your proposal. On approval a real project is created for you to begin work.'],
  ['3', 'Work the Pathway', 'Track your progress from research question to draft, and use project tools (tasks, links, calendar).'],
];

function RoleGuide() {
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <div className="section-head"><div className="section-badge">How it works</div></div>
      <div className="grid grid-3">
        {GUIDE_STEPS.map(([n, title, body]) => (
          <Card key={n} className="paper-card">
            <div className="row" style={{ gap: '0.55rem', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span className="pfp pfp-xs" aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{n}</span>
              <strong>{title}</strong>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

// --- proposals --------------------------------------------------------------

const STATUS_TONE = { pending: 'gold', approved: 'green', rejected: 'red' };

function Proposals({ proposals, onAdd, onRevise }) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="section-badge">Proposals</div>
          <h2 className="section-title">My research proposals</h2>
        </div>
        <Button className="btn-sm" onClick={onAdd}>+ Add a project</Button>
      </div>

      {proposals === null ? (
        <Card>Loading…</Card>
      ) : proposals.length === 0 ? (
        <EmptyState>
          No proposals yet. Click <strong>Add a project</strong> to submit your first research proposal for approval.
        </EmptyState>
      ) : (
        <div className="stack">
          {proposals.map((p) => (
            <Card key={p.id}>
              <div className="card-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                    <Badge tone={STATUS_TONE[p.status] || 'gray'}>{p.status === 'pending' ? 'pending approval' : p.status}</Badge>
                    {p.category && <Badge tone="gray">{p.category}</Badge>}
                  </div>
                  <h3 style={{ margin: '0.4rem 0 0.2rem' }}>{p.title}</h3>
                  {p.description && <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>{p.description}</p>}
                  {p.methodology && <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.82rem' }}><strong>Methodology:</strong> {p.methodology}</p>}
                  <div className="muted" style={{ fontSize: '0.74rem', marginTop: '0.4rem' }}>Submitted {fmt(p.at)}</div>
                </div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  {p.status === 'approved' && p.projectId && (
                    <Link className="btn btn-primary btn-sm" to={`/researcher/project/${p.projectId}`}>Open project →</Link>
                  )}
                  {p.status === 'rejected' && (
                    <Button variant="ghost" className="btn-sm" onClick={() => onRevise(p)}>Revise & resubmit</Button>
                  )}
                </div>
              </div>
              {p.status === 'rejected' && p.feedback && (
                <div className="info-block" style={{ marginTop: '0.7rem' }}>
                  <strong>Moderator feedback:</strong> {p.feedback}
                </div>
              )}
              {p.status === 'approved' && p.feedback && (
                <div className="info-block" style={{ marginTop: '0.7rem' }}>
                  <strong>Moderator note:</strong> {p.feedback}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

const CATEGORIES = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

function ProposalForm({ existing, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: existing?.title || '',
    category: existing?.category || 'Biology',
    description: existing?.description || '',
    methodology: existing?.methodology || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('A title is required.'); return; }
    setBusy(true);
    setError('');
    try {
      if (existing) {
        await api.reviseProposal(existing.id, form);
        toast.success('Proposal resubmitted for approval');
      } else {
        await api.submitProposal(form);
        toast.success('Proposal submitted — pending moderator approval');
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={existing ? 'Revise your proposal' : 'New research proposal'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {error && <div className="login-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          Submitting sends this to a moderator for review. Once approved, a project is created and you can begin work.
        </p>
        <Field label="Project title">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Backyard Pollinator Diversity Census" required />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What question are you investigating, and why does it matter?" />
        </Field>
        <Field label="Intended methodology">
          <textarea rows={3} value={form.methodology} onChange={(e) => setForm({ ...form, methodology: e.target.value })} placeholder="How will you collect and analyze data?" />
        </Field>
        <div className="row" style={{ gap: '0.5rem', marginTop: '0.4rem' }}>
          <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : (existing ? 'Resubmit proposal' : 'Submit for approval')}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

// --- my projects ------------------------------------------------------------

function MyProjects({ projects }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head">
        <div className="section-badge">Workspace</div>
        <h2 className="section-title">My projects</h2>
      </div>
      {projects === null ? (
        <Card>Loading…</Card>
      ) : projects.length === 0 ? (
        <EmptyState>No active projects yet — they appear here once a proposal is approved.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/researcher/project/${p.id}`} style={{ color: 'inherit' }}>
              <Card className="paper-card">
                {p.category && <Badge>{p.category}</Badge>}
                <h3>{p.title}</h3>
                <p className="paper-meta">{(p.members?.length || 0)} member{(p.members?.length || 0) === 1 ? '' : 's'} · {(p.tasks?.length || 0)} task{(p.tasks?.length || 0) === 1 ? '' : 's'}</p>
                <span className="label-up">Open project →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// --- pathways (personal checklist: research question → draft) ----------------

function Pathways() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState({ title: '', deliverable: '', dueAt: '' });
  const load = useCallback(() => { api.pathway().then(setItems).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await api.addPathway(form);
    setForm({ title: '', deliverable: '', dueAt: '' });
    setOpen(false);
    load();
  };
  const seed = async () => {
    setSeeding(true);
    try { await api.seedPathway('own'); await load(); } finally { setSeeding(false); }
  };
  const toggle = (it) => api.togglePathway(it.id, !it.done).then(load);
  const remove = (it) => api.deletePathway(it.id).then(load);

  const done = items.filter((i) => i.done).length;
  const overdue = (it) => it.dueAt && !it.done && new Date(it.dueAt) < new Date(new Date().toDateString());

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="section-badge">Pathways</div>
          <h2 className="section-title">From research question to draft</h2>
        </div>
        <Button className="btn-sm" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : '+ Add step'}</Button>
      </div>

      {open && (
        <Card style={{ marginBottom: '0.75rem' }}>
          <form onSubmit={add}>
            <Field label="What's the next step?"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Draft a research question" required /></Field>
            <div className="grid grid-2">
              <Field label="Deliverable"><input value={form.deliverable} onChange={(e) => setForm({ ...form, deliverable: e.target.value })} placeholder="e.g. 1-paragraph proposal" /></Field>
              <Field label="Due date"><input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field>
            </div>
            <Button type="submit" className="btn-sm">Add to pathway</Button>
          </form>
        </Card>
      )}

      <Card>
        {items.length === 0 ? (
          <div>
            <h3 style={{ marginTop: 0 }}>Set up your research pathway</h3>
            <p className="muted" style={{ marginTop: '0.2rem' }}>
              Start with a guided checklist that takes you from a research question to a first draft. You can add your own steps any time.
            </p>
            <Button className="btn-sm" disabled={seeding} onClick={seed} style={{ marginTop: '0.6rem' }}>{seeding ? 'Setting up…' : 'Add starter milestones'}</Button>
          </div>
        ) : (
          <>
            <div className="progress" style={{ marginBottom: '0.75rem' }}>
              <span style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
            </div>
            {items.map((it) => (
              <div key={it.id} className={`checklist-item ${it.done ? 'done' : ''}`}>
                <input type="checkbox" checked={it.done} onChange={() => toggle(it)} style={{ width: 'auto' }} />
                <div style={{ flex: 1 }}>
                  <span className="ci-title">{it.title}</span>
                  {it.deliverable && <span className="muted" style={{ marginLeft: '0.4rem' }}>· {it.deliverable}</span>}
                </div>
                {it.dueAt && <span className={overdue(it) ? 'overdue' : 'muted'} style={{ fontSize: '0.75rem' }}>{overdue(it) ? 'overdue ' : 'due '}{it.dueAt}</span>}
                <button className="link-btn" style={{ color: 'var(--body-alt)' }} onClick={() => remove(it)} aria-label="Delete">×</button>
              </div>
            ))}
          </>
        )}
      </Card>
    </section>
  );
}
