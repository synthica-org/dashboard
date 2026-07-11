import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, firstNameOf } from '../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState, Pfp } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import OnboardingWizard from '../../components/OnboardingWizard.jsx';
import { imageSrc } from '../../files.js';

const TAG_LABEL = {
  chapter_leader: 'Chapter Leader',
  associate_researcher: 'Associate Researcher',
  lead_researcher: 'Lead Researcher',
  independent_researcher: 'Independent Researcher',
};

// Researcher home: Pathways (top) · personalized feed · projects · role panels.
export default function Dashboard() {
  const { user } = useAuth();
  const tags = user?.tags || [];
  const firstName = firstNameOf(user?.name);

  if (!user) {
    return <div className="page-loading">Loading…</div>;
  }

  return (
    <div>
      <OnboardingWizard />

      <h1 className="page-title">
        Welcome, <span className="yellow-text">{firstName}</span>
      </h1>
      <p className="page-sub">
        Your roles:{' '}
        {tags.map((t) => (
          <Badge key={t}>{TAG_LABEL[t] || t}</Badge>
        ))}
      </p>

      <MemberStats />
      <Pathway />
      <LatestNews />
      <UpcomingDeadlines />
      <Feed />

      {tags.includes('lead_researcher') && <LeadResearcherPanel />}
      {tags.includes('associate_researcher') && <ProjectsPanel isLead={false} />}
      {tags.includes('chapter_leader') && <ChapterPanel />}
      {tags.includes('independent_researcher') && <IndependentPanel />}

      <CertificatesCallout tags={tags} />
    </div>
  );
}

// Nudge toward the Account → Certificates tab whenever a researcher holds a tag
// that earns a downloadable certificate. The full gallery lives in Account so
// there's a single renderer; this is just discovery from the home page.
const CERT_TAGS = ['associate_researcher', 'independent_researcher', 'lead_researcher', 'chapter_leader'];
function CertificatesCallout({ tags }) {
  if (!tags.some((t) => CERT_TAGS.includes(t))) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head">
        <div className="section-badge">Certificates</div>
        <h2 className="section-title">Your role certificates</h2>
      </div>
      <Card>
        <div className="card-row">
          <p className="muted" style={{ margin: 0 }}>
            Download an official, verifiable certificate for each Synthica role you hold — great for college apps and résumés.
          </p>
          <Link className="btn btn-primary btn-sm" to="/researcher/account?tab=certs">View certificates →</Link>
        </div>
      </Card>
    </section>
  );
}

// At-a-glance member stats (LinkedIn-style): profile views, posts, projects, …
function MemberStats() {
  const [s, setS] = useState(null);
  useEffect(() => { api.myStats().then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const stats = [
    ['⭐ Reputation', s.reputation],
    ['Profile views', s.profileViews],
    ['Posts', s.posts],
    ['Projects', s.projects],
    ['Groups', s.groups],
    ['Referrals', s.referrals],
  ];
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <div className="row" style={{ gap: 'clamp(1rem, 4vw, 2.5rem)', flexWrap: 'wrap' }}>
        {stats.map(([label, n]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--brand-deep)' }}>{n}</div>
            <div className="muted" style={{ fontSize: '0.78rem' }}>{label}</div>
          </div>
        ))}
      </div>
      {(s.badges || []).length > 0 && (
        <div className="row" style={{ gap: '0.4rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
          {s.badges.map((b) => <Badge key={b.id} tone="blue" title={b.label}>{b.icon} {b.label}</Badge>)}
        </div>
      )}
    </Card>
  );
}

// Latest announcements widget — the freshest few, with a link to the full page.
function LatestNews() {
  const [news, setNews] = useState(null);
  useEffect(() => { api.news().then(setNews).catch(() => setNews([])); }, []);
  if (!news || news.length === 0) return null;
  const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <div className="section-head" style={{ margin: 0 }}><div className="section-badge">📣 Latest news</div></div>
        <Link to="/researcher/news" className="muted" style={{ fontSize: '0.82rem' }}>View all →</Link>
      </div>
      <div className="stack">
        {news.slice(0, 3).map((n) => (
          <div key={n.id} className="info-block" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
            {n.bannerUrl && <img src={imageSrc(n.bannerUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{n.title}</div>
              <div className="muted" style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>
              <div className="muted" style={{ fontSize: '0.74rem' }}>{n.authorName} · {fmt(n.at)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Personal guided research to-dos (title, deliverable, due date). This is the
// single progress tracker — it replaces the old hardcoded "progress checklist".
function Pathway() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState({ title: '', deliverable: '', dueAt: '' });
  // Note: braces so the effect returns undefined — `useEffect(load)` where load
  // returns the fetch Promise crashes under StrictMode ("destroy is not a function").
  const load = useCallback(() => { api.pathway().then(setItems).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  // Hooks above must run unconditionally (parent already guards a null user).
  if (!user) return null;

  const add = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await api.addPathway(form);
    setForm({ title: '', deliverable: '', dueAt: '' });
    setOpen(false);
    load();
  };
  const seed = async (track) => {
    setSeeding(true);
    try { await api.seedPathway(track); await load(); } finally { setSeeding(false); }
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
          <h2 className="section-title">My research pathway</h2>
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
            <h3 style={{ marginTop: 0 }}>How do you want to start?</h3>
            <p className="muted" style={{ marginTop: '0.2rem' }}>Pick a path and we'll set up your first milestones. You can add your own steps any time.</p>
            <div className="grid grid-2" style={{ marginTop: '0.9rem' }}>
              <div className="info-block">
                <strong>Start my own research</strong>
                <p className="muted" style={{ margin: '0.3rem 0 0.7rem' }}>Pick a question, find a mentor, and create your own project.</p>
                <Button className="btn-sm" disabled={seeding} onClick={() => seed('own')}>Start my own</Button>
              </div>
              <div className="info-block">
                <strong>Join a project</strong>
                <p className="muted" style={{ margin: '0.3rem 0 0.7rem' }}>Browse open projects, apply, and contribute to a team.</p>
                <Button variant="ghost" className="btn-sm" disabled={seeding} onClick={() => seed('join')}>Join a project</Button>
              </div>
            </div>
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
                <button className="link-btn" style={{ color: 'var(--body-alt)' }} onClick={() => remove(it)} aria-label="Delete">✕</button>
              </div>
            ))}
          </>
        )}
      </Card>
    </section>
  );
}

// Compact calendar strip: the next few deadlines, linking to the full page.
function UpcomingDeadlines() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.calendar().then(setItems).catch(() => {}); }, []);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = items?.filter((i) => i.date >= today).slice(0, 4) || [];
  const overdue = items?.filter((i) => i.date < today).length || 0;
  if (!upcoming.length && !overdue) return null;
  const icons = { paper: '📄', task: '✅', event: '📅', pathway: '🧭' };
  const fmt = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-badge">Calendar</div>
        <Link className="link-btn" to="/researcher/calendar">Open calendar →</Link>
      </div>
      {overdue > 0 && (
        <div className="info-block" style={{ marginBottom: '0.6rem', borderLeft: '3px solid var(--danger)' }}>
          ⏰ {overdue} deadline{overdue === 1 ? ' is' : 's are'} overdue — <Link to="/researcher/calendar">review them</Link>.
        </div>
      )}
      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
        {upcoming.map((it) => (
          <Card key={it.id} className="paper-card" style={{ padding: '0.85rem 1rem' }}>
            <div className="row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
              <span style={{ fontSize: '1.2rem' }}>{icons[it.kind] || '📅'}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>{fmt(it.date)} · {it.context}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

// Personalized feed: announcements + people you follow + interest matches.
function Feed() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.feed().then(setItems).catch(() => {}); }, []);
  if (!items?.length) return null;
  const tone = { news: 'gray', following: 'blue', suggested: 'gold', activity: 'blue', chapter: 'gray' };
  const label = { news: 'announcement', following: 'from your network', suggested: 'for you', activity: 'activity', chapter: 'chapter' };
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head"><div className="section-badge">Your feed</div></div>
      <div className="stack">
        {items.map((it, i) => (
          it.type === 'activity' ? (
            <Card key={i}>
              <div className="row" style={{ alignItems: 'center' }}>
                <Pfp name={it.actor?.name} url={imageSrc(it.actor?.avatarUrl)} size="xs" />
                <div style={{ flex: 1 }}>
                  {it.link
                    ? <Link to={it.link}>{it.title}</Link>
                    : <span>{it.title}</span>}
                  <div className="muted" style={{ fontSize: '0.74rem' }}>{it.at ? new Date(it.at).toLocaleDateString() : ''}</div>
                </div>
              </div>
            </Card>
          ) : (
            <Card key={i}>
              {it.bannerUrl && <img src={imageSrc(it.bannerUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: '100%', borderRadius: 12, marginBottom: '0.6rem', maxHeight: 200, objectFit: 'cover' }} />}
              <div className="row" style={{ gap: '0.4rem' }}>
                <Badge tone={tone[it.type] || 'gray'}>{label[it.type] || it.type || 'update'}</Badge>
                <strong>{it.title || 'Untitled'}</strong>
              </div>
              <div style={{ marginTop: '0.25rem' }}>
                {it.doi ? <a href={`/article.html?doi=${encodeURIComponent(it.doi)}`} target="_blank" rel="noreferrer">{it.body || ''}</a> : (it.body || '')}
              </div>
              {it.by && <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>{it.by} · {it.at ? new Date(it.at).toLocaleDateString() : ''}</div>}
            </Card>
          )
        ))}
      </div>
    </section>
  );
}

// New-member onboarding checklist. Self-serve; the leader sees aggregate progress.
function OnboardingCard() {
  const { user } = useAuth();
  const tags = user?.tags || [];
  const [ob, setOb] = useState(null);

  useEffect(() => {
    api.onboarding().then(setOb).catch(() => setOb(null));
  }, []);

  if (!ob) return null; // not in a chapter

  const toggle = (key, done) =>
    api.onboardingStep(key, done).then((r) => setOb({ ...ob, steps: r.steps, pct: r.pct }));

  return (
    <section style={{ marginBottom: '2rem' }}>
      <Card>
        <div className="card-row">
          <div>
            <h3>
              {ob.pct === 100 ? "You're all set 🎉" : 'Get started'} · {ob.chapterName}
            </h3>
            <p className="muted" style={{ margin: '0.2rem 0 0' }}>
              Onboarding {ob.pct}% complete
            </p>
          </div>
          {ob.handbookUrl && (
            <a className="btn btn-ghost btn-sm" href={ob.handbookUrl} target="_blank" rel="noreferrer">
              Chapter handbook
            </a>
          )}
        </div>
        <div className="progress" style={{ margin: '0.6rem 0 0.9rem' }}>
          <span style={{ width: `${ob.pct}%` }} />
        </div>
        {ob.steps.map((s) => (
          <div key={s.key} className={`checklist-item ${s.done ? 'done' : ''}`}>
            <input
              type="checkbox"
              checked={s.done}
              onChange={(e) => toggle(s.key, e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span className="ci-title">{s.label}</span>
          </div>
        ))}
        {!tags.includes('lead_researcher') && (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            Ready for more? <Link to="/researcher/apply">Apply to lead a project or join the team →</Link>
          </p>
        )}
      </Card>
    </section>
  );
}

// Google-Classroom-style grid of the researcher's projects.
function ProjectsPanel({ isLead }) {
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    api.myProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head">
        <div className="section-badge">{isLead ? 'Lead Researcher' : 'Associate Researcher'}</div>
        <h2 className="section-title">My Projects</h2>
      </div>
      {projects.length === 0 ? (
        <EmptyState>You're not on any projects yet — check the Research Hub.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/researcher/project/${p.id}`} style={{ color: 'inherit' }}>
              <Card className="paper-card">
                <Badge>{p.category}</Badge>
                <h3>{p.title}</h3>
                <p className="paper-meta">{p.members.length} members · {p.tasks.length} tasks</p>
                <span className="label-up">Open project →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// Lead Researcher dashboard: manage projects, members, and project lifecycle.
function LeadResearcherPanel() {
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'Computer Science', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => api.myProjects().then(setProjects).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const createProject = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.createProject(form);
      setForm({ title: '', category: 'Computer Science', description: '' });
      setCreating(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const categories = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="section-badge">Lead Researcher</div>
          <h2 className="section-title">My Projects</h2>
        </div>
        <Button className="btn-sm" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ New project'}
        </Button>
      </div>

      {creating && (
        <Card style={{ marginBottom: '1rem' }}>
          <form onSubmit={createProject}>
            {error && <div className="login-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
            <Field label="Project title">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. AI Ethics in Healthcare" required />
            </Field>
            <div className="grid grid-2">
              <Field label="Category">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description (optional)">
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief overview of the project goals..." />
            </Field>
            <Button type="submit" className="btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</Button>
          </form>
        </Card>
      )}

      {projects.length === 0 ? (
        <EmptyState>You haven't created any projects yet. Click "New project" to get started.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/researcher/project/${p.id}`} style={{ color: 'inherit' }}>
              <Card className="paper-card">
                <div className="card-row" style={{ marginBottom: '0.5rem' }}>
                  <Badge>{p.category}</Badge>
                  <span className="muted" style={{ fontSize: '0.72rem' }}>{p.status || 'Active'}</span>
                </div>
                <h3>{p.title}</h3>
                <p className="paper-meta">{p.members?.length || 0} members · {p.tasks?.length || 0} tasks</p>
                {p.description && <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>{p.description.slice(0, 80)}{p.description.length > 80 ? '…' : ''}</p>}
                <span className="label-up">Manage project →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// Chapter leaders: live roster (contacts + onboarding + projects), stats, and
// Chapter broadcast: the leader posts; members get notified + see it in their feed.
function ChapterAnnouncements({ chapter, onPosted }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.chapterAnnounce(form);
      setForm({ title: '', body: '' });
      setOpen(false);
      onPosted();
    } catch (error) { setErr(error.message); } finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: '1.1rem' }}>
      <div className="card-row">
        <h3>Chapter announcements</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : '📣 Send announcement'}</button>
      </div>
      {err && <div className="login-error" style={{ marginTop: '0.5rem' }}>{err}</div>}
      {open && (
        <form onSubmit={send} style={{ marginTop: '0.6rem' }}>
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Chapter meeting Friday" required /></Field>
          <Field label="Message"><textarea rows={2} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Library room B, 4pm — bring your drafts!" /></Field>
          <Button type="submit" className="btn-sm" disabled={busy}>{busy ? 'Sending…' : 'Send to all members'}</Button>
          <span className="muted" style={{ marginLeft: '0.6rem', fontSize: '0.78rem' }}>Everyone in the chapter gets a notification + feed post.</span>
        </form>
      )}
      {(chapter.announcements || []).length > 0 && (
        <div className="stack" style={{ marginTop: '0.7rem' }}>
          {chapter.announcements.slice(0, 5).map((a) => (
            <div key={a.id} className="info-block">
              <strong>{a.title}</strong>
              {a.body && <p className="muted" style={{ margin: '0.2rem 0 0' }}>{a.body}</p>}
              <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}>{new Date(a.at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// the ability to onboard a new member.
function ChapterPanel() {
  const [chapter, setChapter] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', discord: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api.chapter().then(setChapter).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return null; // not a chapter leader / no chapter
  if (!chapter) return null;

  const addMember = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.addChapterMember(form);
      setForm({ name: '', email: '', discord: '' });
      setAdding(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const s = chapter.stats;

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head">
        <div className="section-badge">Chapter Leader</div>
        <h2 className="section-title">{chapter.name}</h2>
        <Link to="/researcher/chapter" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}>
          View Chapter →
        </Link>
      </div>

      {/* Generated chapter stats */}
      <div className="grid grid-3" style={{ marginBottom: '1.1rem' }}>
        <Stat label="Members" value={s.members} />
        <Stat label="Fully onboarded" value={`${s.fullyOnboarded}/${s.members}`} />
        <Stat label="Avg onboarding" value={`${s.avgOnboarding}%`} />
      </div>

      <ChapterAnnouncements chapter={chapter} onPosted={load} />

      <Card>
        <div className="card-row">
          <h3>Members</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : 'Onboard a member'}
          </button>
        </div>

        {adding && (
          <form onSubmit={addMember} className="info-block" style={{ marginTop: '0.75rem' }}>
            <input type="email" placeholder="Member email (required)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required style={{ marginBottom: '0.5rem' }} />
            <div className="grid grid-2">
              <input placeholder="Full name (only if new)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="Discord (optional)" value={form.discord} onChange={(e) => setForm({ ...form, discord: e.target.value })} />
            </div>
            <button className="btn btn-primary btn-sm" style={{ marginTop: '0.6rem' }} disabled={busy}>
              {busy ? 'Adding…' : 'Add to chapter'}
            </button>
            <p className="muted" style={{ marginTop: '0.4rem' }}>
              If they already have a Synthica account, we'll add them by email and tag them. Otherwise enter a name to create one.
            </p>
          </form>
        )}

        <div className="stack" style={{ marginTop: '0.75rem' }}>
          {chapter.members.map((m) => (
            <div key={m.userId} className="info-block">
              <div className="card-row">
                <div>
                  <strong>{m.name}</strong> {m.onboarded && <Badge tone="green">onboarded</Badge>}
                  <div className="muted" style={{ fontSize: '0.78rem' }}>
                    <a href={`mailto:${m.email}`}>{m.email}</a>
                    {m.discord && <> · Discord: {m.discord}</>}
                  </div>
                  {m.projects.length > 0 && (
                    <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>
                      Projects: {m.projects.join(', ')}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 120 }}>
                  <div className="muted" style={{ fontSize: '0.72rem', textAlign: 'right' }}>{m.onboardingPct}%</div>
                  <div className="progress">
                    <span style={{ width: `${m.onboardingPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <Card>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--ink)' }}>{value}</div>
      <div className="muted">{label}</div>
    </Card>
  );
}

// Independent researchers: point them to their dedicated workspace (propose a
// project → moderator approval → Pathways) and keep curated resources handy.
function IndependentPanel() {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="section-badge">Independent Researcher</div>
          <h2 className="section-title">Your workspace</h2>
        </div>
        <Link className="btn btn-primary btn-sm" to="/researcher/independent">Open workspace →</Link>
      </div>
      <Card>
        <p style={{ marginTop: 0 }}>
          Propose and run solo projects from your <Link to="/researcher/independent">Independent workspace</Link> — submit a research proposal, get it approved by a moderator, and track your Pathway from research question to draft.
        </p>
        <p className="muted" style={{ marginBottom: '0.3rem' }}>Resources to help along the way:</p>
        <ul className="muted" style={{ lineHeight: 1.9, paddingLeft: '1.1rem', marginTop: 0 }}>
          <li><a href="/free-course.html">Free research methods course</a></li>
          <li><a href="/resources.html">How to read a paper</a></li>
          <li><a href="/resources.html">Finding a dataset</a></li>
          <li><a href="/article.html">Journal submission guide</a></li>
        </ul>
      </Card>
    </section>
  );
}
