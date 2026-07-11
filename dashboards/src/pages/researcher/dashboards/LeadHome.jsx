import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth, firstNameOf } from '../../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState, Pfp } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../components/toast.jsx';
import { imageSrc } from '../../../files.js';

const CATS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

// Lead Researcher workspace home (ROLE_WORKFLOWS §5.1). One place to recruit,
// review applicants, and jump into the teams you run.
export default function LeadHome() {
  const { user } = useAuth();
  const toast = useToast();
  const [listings, setListings] = useState(null); // my listings (with applicant detail)
  const [projects, setProjects] = useState(null); // projects I'm on
  const [creating, setCreating] = useState(false); // project|listing|null

  const load = useCallback(() => {
    api.myListings().then(setListings).catch(() => setListings([]));
    api.myProjects().then(setProjects).catch(() => setProjects([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!user) return <div className="page-loading">Loading…</div>;

  const myProjects = (projects || []).filter((p) => p.leadId === user.id);
  const pendingTotal = (listings || []).reduce((n, l) => n + (l.stats?.pending || 0), 0);
  const openSpots = (listings || []).reduce((n, l) => n + Math.max(0, (l.spots || 0) - (l.stats?.approved || 0)), 0);

  return (
    <div>
      <DashboardHero
        firstName={firstNameOf(user.name)}
        stats={{ projects: myProjects.length, listings: (listings || []).length, pending: pendingTotal, openSpots }}
        onCreateProject={() => { setCreating('project'); scrollToCreate(); }}
        onCreateListing={() => { setCreating('listing'); scrollToCreate(); }}
      />

      {pendingTotal > 0 && <PendingApplicants listings={listings} onReviewed={load} />}

      <div id="lead-create">
        {creating === 'project' && <CreateProject onDone={() => { setCreating(null); load(); }} onCancel={() => setCreating(null)} />}
        {creating === 'listing' && <CreateListing projects={myProjects} onDone={() => { setCreating(null); load(); }} onCancel={() => setCreating(null)} />}
      </div>

      <MyListings listings={listings} onChanged={load} />

      <MyTeams projects={myProjects} />

      <RoleGuide />
    </div>
  );
}

function scrollToCreate() {
  // Defer so the form has mounted before we scroll it into view.
  setTimeout(() => document.getElementById('lead-create')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

// --- Hero: who you are + the numbers that matter + quick actions ------------
function DashboardHero({ firstName, stats, onCreateProject, onCreateListing }) {
  const cells = [
    ['Projects led', stats.projects],
    ['Active listings', stats.listings],
    ['To review', stats.pending],
    ['Open spots', stats.openSpots],
  ];
  return (
    <Card className="lead-hero" style={{ marginBottom: '1.5rem' }}>
      <div className="lead-hero-head">
        <div>
          <Badge tone="gold">Lead workspace</Badge>
          <h1 className="page-title" style={{ margin: '0.5rem 0 0.2rem' }}>
            Welcome back, <span className="yellow-text">{firstName}</span>
          </h1>
          <p className="page-sub" style={{ margin: 0 }}>Lead researcher — run your team, recruit collaborators, and publish.</p>
        </div>
        <div className="row" style={{ flexShrink: 0 }}>
          <Button className="btn-sm" onClick={onCreateProject}><Icon name="plus" size={15} /> New project</Button>
          <Button className="btn-sm" variant="ghost" onClick={onCreateListing}><Icon name="megaphone" size={15} /> Post listing</Button>
          <Link className="btn btn-ghost btn-sm" to="/researcher/people"><Icon name="users" size={15} /> Invite</Link>
        </div>
      </div>
      <div className="lead-hero-stats">
        {cells.map(([label, n]) => (
          <div key={label} className="lead-stat">
            <div className="lead-stat-n">{n}</div>
            <div className="muted">{label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- Pending applicants across all listings (the lead's action queue) -------
function PendingApplicants({ listings, onReviewed }) {
  const toast = useToast();
  const queue = useMemo(() => {
    const out = [];
    for (const l of listings || []) {
      for (const a of l.applicantsDetail || []) {
        if (a.status === 'pending') out.push({ ...a, listingTitle: l.title, listingId: l.id, questions: l.customQuestions || [] });
      }
    }
    return out.sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [listings]);

  const review = (a, status) =>
    api.reviewListingApplication(a.id, status)
      .then(() => { toast.success(`${a.name} ${status === 'approved' ? 'accepted' : 'passed'}`); onReviewed(); })
      .catch((e) => toast.error(e.message));

  if (!queue.length) return null;
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div className="section-head">
        <div className="section-badge">Needs your review</div>
        <h2 className="section-title">{queue.length} applicant{queue.length === 1 ? '' : 's'} waiting</h2>
      </div>
      <div className="stack">
        {queue.map((a) => (
          <ApplicantCard key={a.id} a={a} subtitle={<>for <strong>{a.listingTitle}</strong></>} onReview={review} />
        ))}
      </div>
    </section>
  );
}

// A single applicant: profile snapshot + custom answers + accept/pass.
function ApplicantCard({ a, subtitle, onReview }) {
  return (
    <Card>
      <div className="card-row" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: '0.7rem', minWidth: 0 }}>
          <Pfp name={a.name} url={imageSrc(a.avatarUrl)} size="xs" />
          <div style={{ minWidth: 0 }}>
            <Link to={`/p/${a.slug}`} target="_blank"><strong>{a.name}</strong></Link>
            {subtitle && <span className="muted" style={{ marginLeft: '0.35rem' }}>{subtitle}</span>}
            {a.blurb && <div className="muted">{a.blurb}</div>}
            <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}>
              {a.institution && <>{a.institution} · </>}
              Research {a.researchExperience ?? '—'}/10 · Leadership {a.leadershipExperience ?? '—'}/10
              {a.resumeUrl && <> · <a href={a.resumeUrl} target="_blank" rel="noreferrer">résumé</a></>}
              {' · '}{new Date(a.at).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div className="row" style={{ flexShrink: 0 }}>
          {a.status === 'pending' ? (
            <>
              <Button className="btn-sm" variant="approve" onClick={() => onReview(a, 'approved')}>Accept</Button>
              <Button className="btn-sm" variant="reject" onClick={() => onReview(a, 'rejected')}>Pass</Button>
            </>
          ) : (
            <Badge tone={a.status === 'approved' ? 'green' : 'red'}>{a.status}</Badge>
          )}
        </div>
      </div>

      {a.message && <p className="muted" style={{ margin: '0.5rem 0 0', fontStyle: 'italic' }}>“{a.message}”</p>}

      {(a.answers || []).length > 0 && (
        <div className="qa-block">
          {a.answers.map((qa) => (
            <div key={qa.id} className="qa-item">
              <div className="qa-q">{qa.label}</div>
              <div className="qa-a">{qa.answer || <span className="muted">— no answer —</span>}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Custom-question editor (shared by create/edit listing + create project) -
// Lets a lead toggle custom application mode on and define free-text questions.
function CustomQuestions({ on, questions, onToggle, onChange }) {
  const setQ = (i, patch) => onChange(questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const add = () => onChange([...questions, { label: '', required: true }]);
  const remove = (i) => onChange(questions.filter((_, idx) => idx !== i));
  return (
    <div className="info-block" style={{ marginTop: '0.4rem' }}>
      <label className="row" style={{ gap: '0.5rem', cursor: 'pointer', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} style={{ width: 'auto', marginTop: '0.2rem' }} />
        <span>
          <strong>Custom application questions</strong>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            Off: applicants apply with a short message + their profile. On: they must also answer your questions.
          </div>
        </span>
      </label>

      {on && (
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          {questions.length === 0 && <p className="muted" style={{ margin: 0 }}>Add at least one question for custom mode to apply.</p>}
          {questions.map((q, i) => (
            <div key={i} className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              <input
                style={{ flex: 1 }}
                value={q.label}
                onChange={(e) => setQ(i, { label: e.target.value })}
                placeholder={`Question ${i + 1} — e.g. Which tools are you comfortable with?`}
              />
              <label className="muted row" style={{ gap: '0.25rem', fontSize: '0.78rem', flexShrink: 0 }} title="Applicant must answer">
                <input type="checkbox" checked={q.required !== false} onChange={(e) => setQ(i, { required: e.target.checked })} style={{ width: 'auto' }} />
                required
              </label>
              <button type="button" className="link-btn" onClick={() => remove(i)} aria-label="Remove question" style={{ flexShrink: 0 }}><Icon name="x" size={15} /></button>
            </div>
          ))}
          <div><Button type="button" variant="ghost" className="btn-sm" onClick={add}><Icon name="plus" size={15} /> Add question</Button></div>
        </div>
      )}
    </div>
  );
}

// --- Create project (auto-publishes a linked Hub listing, §5.2/§5.6) --------
function CreateProject({ onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', category: CATS[0], description: '', spots: 2 });
  const [publish, setPublish] = useState(true);
  const [customOn, setCustomOn] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      await api.createProject({
        ...f,
        publishListing: publish,
        customApplication: publish && customOn,
        customQuestions: publish && customOn ? questions : [],
      });
      toast.success(publish ? 'Project created and listed on the Research Hub' : 'Project created');
      onDone();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <div className="card-row">
        <div>
          <strong>New project</strong>
          <div className="muted" style={{ fontSize: '0.8rem' }}>A project gives your team a workspace and (optionally) a recruiting listing.</div>
        </div>
        <Button variant="ghost" className="btn-sm" onClick={onCancel}>Cancel</Button>
      </div>
      <form onSubmit={submit} className="pop-in" style={{ marginTop: '0.75rem' }}>
        <Field label="Project title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Modeling Coral Bleaching" required /></Field>
        <div className="grid grid-2">
          <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Open spots to recruit"><input type="number" min="1" value={f.spots} onChange={(e) => setF({ ...f, spots: e.target.value })} /></Field>
        </div>
        <Field label="Project brief"><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What's the project about and who do you need?" /></Field>

        <label className="row" style={{ gap: '0.5rem', cursor: 'pointer', margin: '0.2rem 0' }}>
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} style={{ width: 'auto' }} />
          <span>Publish a listing on the Research Hub so associates can apply</span>
        </label>

        {publish && (
          <CustomQuestions on={customOn} questions={questions} onToggle={setCustomOn} onChange={setQuestions} />
        )}

        <Button type="submit" className="btn-sm" disabled={busy} style={{ marginTop: '0.75rem' }}>{busy ? 'Creating…' : 'Create project'}</Button>
      </form>
    </Card>
  );
}

// --- Create a standalone listing (optionally tied to an existing project) ----
function CreateListing({ projects, onDone, onCancel }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', category: CATS[0], spots: 2, description: '', lookingFor: '', bannerUrl: '', projectId: '' });
  const [customOn, setCustomOn] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      await api.createListing({ ...f, customApplication: customOn, customQuestions: customOn ? questions : [] });
      toast.success('Listing posted to the Research Hub');
      onDone();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <div className="card-row">
        <div>
          <strong>Post a recruiting listing</strong>
          <div className="muted" style={{ fontSize: '0.8rem' }}>Advertise open spots. Link it to a project so accepted applicants join the team.</div>
        </div>
        <Button variant="ghost" className="btn-sm" onClick={onCancel}>Cancel</Button>
      </div>
      <form onSubmit={submit} className="pop-in" style={{ marginTop: '0.75rem' }}>
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Looking for a data analyst" required /></Field>
        <div className="grid grid-3">
          <Field label="Subject"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Open spots"><input type="number" min="1" value={f.spots} onChange={(e) => setF({ ...f, spots: e.target.value })} /></Field>
          {projects.length > 0 && (
            <Field label="Link to project (optional)">
              <select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
                <option value="">— none —</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Description"><textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Looking for (comma-separated)"><input value={f.lookingFor} onChange={(e) => setF({ ...f, lookingFor: e.target.value })} placeholder="data analyst, writer" /></Field>
        <Field label="Banner image URL (optional)"><input value={f.bannerUrl} onChange={(e) => setF({ ...f, bannerUrl: e.target.value })} placeholder="https://…" /></Field>
        <CustomQuestions on={customOn} questions={questions} onToggle={setCustomOn} onChange={setQuestions} />
        <Button type="submit" className="btn-sm" disabled={busy} style={{ marginTop: '0.75rem' }}>{busy ? 'Posting…' : 'Post listing'}</Button>
      </form>
    </Card>
  );
}

// --- My listings: lifecycle (edit/close) + full applicant review ------------
function MyListings({ listings, onChanged }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);

  const review = (a, status) =>
    api.reviewListingApplication(a.id, status)
      .then(() => { toast.success(`${a.name} ${status === 'approved' ? 'accepted' : 'passed'}`); onChanged(); })
      .catch((e) => toast.error(e.message));
  const close = (l) => {
    if (!window.confirm(`Close “${l.title}”? Pending applicants will be notified.`)) return;
    api.deleteListing(l.id).then(() => { toast.success('Listing closed'); onChanged(); }).catch((e) => toast.error(e.message));
  };

  if (listings === null) return null;

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div className="section-head">
        <div className="section-badge">Recruiting</div>
        <h2 className="section-title">My listings</h2>
      </div>
      {listings.length === 0 ? (
        <EmptyState>No active listings. Create a project or post a listing to start recruiting.</EmptyState>
      ) : (
        <div className="stack">
          {listings.map((l) => (
            <Card key={l.id}>
              <div className="card-row">
                <div style={{ minWidth: 0 }}>
                  <strong>{l.title}</strong> <Badge tone="gray">{l.category}</Badge>
                  {l.customApplication && <Badge tone="gold">custom application</Badge>}
                  <div className="row" style={{ gap: '0.35rem', marginTop: '0.35rem' }}>
                    <Badge tone="blue">{l.stats.applicants} applicant{l.stats.applicants === 1 ? '' : 's'}</Badge>
                    {l.stats.pending > 0 && <Badge tone="gold">{l.stats.pending} to review</Badge>}
                    <Badge tone={l.stats.approved >= l.spots ? 'green' : 'gray'}>{l.stats.approved}/{l.spots} spots filled</Badge>
                    {l.projectId && <Link className="muted" style={{ fontSize: '0.78rem' }} to={`/researcher/project/${l.projectId}`}>open project →</Link>}
                  </div>
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <Button className="btn-sm" variant="ghost" onClick={() => setEditing(editing === l.id ? null : l.id)}>{editing === l.id ? 'Cancel' : 'Edit'}</Button>
                  <Button className="btn-sm" variant="reject" onClick={() => close(l)}>Close</Button>
                </div>
              </div>

              {editing === l.id && <EditListing listing={l} onSaved={() => { setEditing(null); onChanged(); toast.success('Listing updated'); }} />}

              {l.applicantsDetail.length > 0 && (
                <div className="stack" style={{ marginTop: '0.7rem', borderTop: '1px solid var(--border)', paddingTop: '0.7rem' }}>
                  {l.applicantsDetail.map((a) => (
                    <ApplicantCard key={a.id} a={{ ...a, questions: l.customQuestions || [] }} onReview={review} />
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// Inline edit — pre-filled, including the custom-question editor.
function EditListing({ listing, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    title: listing.title, category: listing.category || CATS[0], spots: listing.spots,
    description: listing.description || '', lookingFor: listing.lookingFor || '', bannerUrl: listing.bannerUrl || '',
  });
  const [customOn, setCustomOn] = useState(!!listing.customApplication);
  const [questions, setQuestions] = useState(listing.customQuestions || []);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateListing(listing.id, { ...f, customApplication: customOn, customQuestions: questions });
      onSaved();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} style={{ marginTop: '0.7rem', borderTop: '1px solid var(--border)', paddingTop: '0.7rem' }}>
      <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
      <div className="grid grid-3">
        <Field label="Subject"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Open spots"><input type="number" min="1" value={f.spots} onChange={(e) => setF({ ...f, spots: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Looking for (comma-separated)"><input value={f.lookingFor} onChange={(e) => setF({ ...f, lookingFor: e.target.value })} placeholder="data analyst, writer" /></Field>
      <Field label="Banner image URL"><input value={f.bannerUrl} onChange={(e) => setF({ ...f, bannerUrl: e.target.value })} placeholder="https://…" /></Field>
      <CustomQuestions on={customOn} questions={questions} onToggle={setCustomOn} onChange={setQuestions} />
      <Button type="submit" className="btn-sm" disabled={busy} style={{ marginTop: '0.75rem' }}>{busy ? 'Saving…' : 'Save changes'}</Button>
    </form>
  );
}

// --- Teams I run (classroom-style project cards) ----------------------------
function MyTeams({ projects }) {
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <div className="section-head">
        <div className="section-badge">Teams</div>
        <h2 className="section-title">Projects I lead</h2>
      </div>
      {projects.length === 0 ? (
        <EmptyState>No projects yet — create one above to spin up a team workspace.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/researcher/project/${p.id}`} style={{ color: 'inherit' }}>
              <Card className="paper-card">
                <div className="card-row" style={{ marginBottom: '0.4rem' }}>
                  <Badge>{p.category}</Badge>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>{p.status || 'Active'}</span>
                </div>
                <h3>{p.title}</h3>
                <p className="paper-meta">{p.members?.length || 0} member{p.members?.length === 1 ? '' : 's'} · {p.tasks?.length || 0} task{p.tasks?.length === 1 ? '' : 's'}</p>
                <span className="label-up">Manage project →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// --- What a lead can do (orientation) ---------------------------------------
function RoleGuide() {
  const items = [
    ['flask', 'Create projects', 'Spin up a team workspace with tasks, links, announcements, and a roster.'],
    ['megaphone', 'Recruit on the Hub', 'Every project can publish a listing so associates discover and apply.'],
    ['file-text', 'Custom applications', 'Add your own questions to a listing and review answers before accepting.'],
    ['check-circle', 'Accept or pass', 'Accepting adds the applicant to your project team and fills a spot.'],
    ['users', 'Invite directly', 'Add collaborators by name or email straight into a project.'],
    ['microscope', 'Group your work', 'Bundle related projects under a research group identity.'],
  ];
  return (
    <section style={{ marginBottom: '1rem' }}>
      <div className="section-head">
        <div className="section-badge">What you can do</div>
        <h2 className="section-title">Lead researcher toolkit</h2>
      </div>
      <div className="grid grid-3">
        {items.map(([icon, title, body]) => (
          <Card key={title}>
            <span className="guide-ico" aria-hidden="true"><Icon name={icon} size={20} /></span>
            <h3 style={{ margin: '0.3rem 0 0.2rem', fontSize: '1rem' }}>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>{body}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
