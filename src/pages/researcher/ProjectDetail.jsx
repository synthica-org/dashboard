import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Badge, Button, Field, Pfp } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';
import { Embed, embedSrc } from '../../components/embed.jsx';

// Quiet "⋯" overflow for secondary per-row controls (remove/rename/settings-ish),
// so each view keeps one visible primary action. Same <details> pattern as
// SafetyMenu; reuses its popover styles for one consistent menu look.
function OverflowMenu({ label = 'More options', align = 'right', children }) {
  return (
    <details className="safety-menu">
      <summary className="safety-menu-trigger" title={label} aria-label={label}>
        <Icon name="more-horizontal" size={16} />
      </summary>
      <div className={`safety-menu-pop ${align === 'left' ? 'left' : ''}`}>{children}</div>
    </details>
  );
}

function MenuItem({ onClick, disabled, children }) {
  const click = (e) => {
    const d = e.currentTarget.closest('details');
    if (d) d.open = false;
    onClick?.(e);
  };
  return <button type="button" disabled={disabled} onClick={click}>{children}</button>;
}

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (d, done) => d && !done && String(d).slice(0, 10) < today();
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

const STATUS_TONE = { todo: 'gray', awaiting_approval: 'gold', in_progress: 'blue', done: 'green' };
const STATUS_LABEL = { todo: 'to do', awaiting_approval: 'awaiting approval', in_progress: 'in progress', done: 'done' };

// Tabs that organize the classroom-style workspace. Members and the lead see the
// same tabs; lead-only controls appear inside each section.
const SECTIONS = ['Overview', 'Tasks', 'Calendar', 'Team', 'Ideas', 'Resources', 'Announcements'];

// Classroom-style project page. Members see tasks, calendar, team, ideas, links
// and announcements; the lead additionally gets teacher-style controls
// (assign/approve tasks, post announcements, edit roles, invite, choose ideas).
export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Overview');

  const load = useCallback(() => {
    api.project(id).then(setProject).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="login-error">{error}</div>;
  if (!project) return <p className="muted">Loading project…</p>;

  const tasks = project.tasks || [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  // No persisted project status field — derive a friendly one from progress.
  const status = total === 0 ? { label: 'Getting started', tone: 'gray' }
    : pct === 100 ? { label: 'Complete', tone: 'green' }
      : done > 0 ? { label: 'In progress', tone: 'blue' }
        : { label: 'Just kicked off', tone: 'gold' };
  const team = project.team || [];

  return (
    <div>
      <Link to="/researcher/projects" className="label-up">← Back to My Projects</Link>
      <div className="card-row" style={{ marginTop: '0.5rem', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{project.title}</h1>
          <p className="page-sub" style={{ marginTop: '0.4rem' }}>
            <Badge>{project.category || 'Uncategorized'}</Badge>{' '}
            <Badge tone={status.tone}>{status.label}</Badge>{' '}
            {project.isLead && <Badge tone="gold">you lead this</Badge>}
          </p>
        </div>
        {team.length > 0 && (
          <a className="btn btn-primary btn-sm" href={`mailto:${team.map((m) => m.email).filter(Boolean).join(',')}`}>
            Email team
          </a>
        )}
      </div>
      <p style={{ color: 'var(--body)', maxWidth: 760, marginTop: '0.3rem' }}>
        {project.description || <span className="muted">No description yet.</span>}
      </p>

      {/* Section navigation (clearly-titled sections, classroom style). */}
      <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', margin: '1.25rem 0' }}>
        {SECTIONS.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${tab === s ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(s)}
          >
            {s}
            {s === 'Tasks' && total > 0 ? ` (${done}/${total})` : ''}
            {s === 'Team' ? ` (${team.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview project={project} pct={pct} done={done} total={total} onJump={setTab} />}
      {tab === 'Tasks' && <TasksCard project={project} onChange={load} />}
      {tab === 'Calendar' && <ProjectCalendar project={project} onChange={load} />}
      {tab === 'Team' && <TeamSection project={project} onChange={load} />}
      {tab === 'Ideas' && <IdeasCard project={project} onChange={load} />}
      {tab === 'Resources' && <LinksCard project={project} onChange={load} />}
      {tab === 'Announcements' && <Announcements project={project} onChange={load} />}
    </div>
  );
}

// Overview: at-a-glance progress, latest announcement, chosen idea, next deadline.
function Overview({ project, pct, done, total, onJump }) {
  const tasks = project.tasks || [];
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const awaiting = tasks.filter((t) => t.status === 'awaiting_approval').length;
  const chosen = (project.ideas || []).find((i) => i.chosen);
  const latest = (project.announcements || [])[0];
  const nextTask = tasks
    .filter((t) => t.dueAt && t.status !== 'done')
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))[0];

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="stack">
        <Card>
          <h3 style={{ marginTop: 0 }}>Progress</h3>
          <div className="progress" style={{ margin: '0.5rem 0' }}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">{done} of {total} tasks complete ({pct}%)</p>
          <div className="row" style={{ marginTop: '0.6rem', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Badge tone="blue">{inProgress} in progress</Badge>
            <Badge tone="gold">{awaiting} awaiting approval</Badge>
            <Badge tone="gray">{(project.members || []).length} members</Badge>
            <Badge tone="gray">{tasks.filter((t) => t.type === 'question').length} questions</Badge>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.75rem' }} onClick={() => onJump('Tasks')}>
            Open task board →
          </button>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>Next deadline</h3>
          {nextTask ? (
            <div className="info-block">
              <div className="card-row">
                <strong>{nextTask.title}</strong>
                <span className={isOverdue(nextTask.dueAt, false) ? 'overdue' : 'muted'} style={{ fontSize: '0.78rem' }}>
                  {isOverdue(nextTask.dueAt, false) ? 'overdue · ' : 'due '}{fmtDate(nextTask.dueAt)}
                </span>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No upcoming deadlines.</p>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.6rem' }} onClick={() => onJump('Calendar')}>
            View calendar →
          </button>
        </Card>
      </div>

      <div className="stack">
        <Card>
          <h3 style={{ marginTop: 0 }}>Chosen direction</h3>
          {chosen ? (
            <div className="info-block">{chosen.text}</div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>The team hasn't picked a research direction yet.</p>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.6rem' }} onClick={() => onJump('Ideas')}>
            Brainstorm ideas →
          </button>
        </Card>

        <Card>
          <h3 style={{ marginTop: 0 }}>Latest announcement</h3>
          {latest ? (
            <div className="info-block">
              {latest.body}
              <div className="muted" style={{ marginTop: '0.25rem', fontSize: '0.78rem' }}>{new Date(latest.at).toLocaleString()}</div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No announcements yet.</p>
          )}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.6rem' }} onClick={() => onJump('Announcements')}>
            All announcements →
          </button>
        </Card>
      </div>
    </div>
  );
}

// Task board: questions float to the top (hierarchy), then everything else. Any
// member can add tasks + assign people; steps that need approval wait for the
// lead, who can approve them to start.
function TasksCard({ project, onChange }) {
  const id = project.id;
  const team = project.team || [];
  const { user } = useAuth();
  const toast = useToast();
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'task', dueAt: '', requiresApproval: false });

  // team[].id is the member's user id (matches task.assignedTo entries).
  const nameOf = (uid) => team.find((m) => m.id === uid)?.name || '—';
  const run = (p) => p.then(onChange).catch((e) => { setError(e.message); toast.error(e.message); });

  const add = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    run(api.addTask(id, form));
    setForm({ title: '', type: 'task', dueAt: '', requiresApproval: false });
    setAdding(false);
  };

  // Questions first (top of the hierarchy), then the rest. Optional "mine" filter.
  let ordered = [...(project.tasks || [])].sort((a, b) => (b.type === 'question') - (a.type === 'question'));
  if (mineOnly) ordered = ordered.filter((t) => (t.assignedTo || []).includes(user.id));

  return (
    <Card>
      <div className="card-row">
        <h3 style={{ margin: 0 }}>Tasks &amp; questions</h3>
        <div className="row">
          <button className={`btn btn-sm ${mineOnly ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMineOnly((m) => !m)}>
            Assigned to me
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Cancel' : '+ Add task'}
          </button>
        </div>
      </div>
      <p className="muted" style={{ margin: '0.3rem 0 0' }}>
        Anyone can add a task and assign teammates. Steps marked “needs approval” wait for the lead before work starts.
      </p>
      {error && <div className="login-error" style={{ marginTop: '0.5rem' }}>{error}</div>}

      {adding && (
        <form onSubmit={add} className="info-block" style={{ marginTop: '0.6rem' }}>
          <input placeholder="Title…" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required style={{ marginBottom: '0.5rem' }} />
          <div className="grid grid-3">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="task">Task</option>
              <option value="reading">Reading</option>
              <option value="question">Research question</option>
            </select>
            <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            <label className="row" style={{ fontSize: '0.82rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} />
              needs lead approval to start
            </label>
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: '0.6rem' }}>Add task</button>
        </form>
      )}

      {ordered.length === 0 ? (
        <p className="muted" style={{ marginTop: '0.6rem' }}>No tasks yet — add the first one.</p>
      ) : (
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          {ordered.map((t) => (
            <div key={t.id} className="info-block">
              <div className="card-row">
                <div className="row" style={{ gap: '0.4rem' }}>
                  <Badge tone={t.type === 'question' ? 'blue' : 'gray'}>{t.type}</Badge>
                  <Badge tone={STATUS_TONE[t.status] || 'gray'}>{STATUS_LABEL[t.status] || t.status}</Badge>
                </div>
                {t.dueAt && (
                  <span className={isOverdue(t.dueAt, t.status === 'done') ? 'overdue' : 'muted'} style={{ fontSize: '0.75rem' }}>
                    {isOverdue(t.dueAt, t.status === 'done') ? 'overdue ' : 'due '}{fmtDate(t.dueAt)}
                  </span>
                )}
              </div>
              <div className={t.status === 'done' ? 'ci-title' : ''} style={{ marginTop: '0.35rem', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                {t.title}
              </div>
              <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                {(t.assignedTo || []).length ? `Assigned: ${t.assignedTo.map(nameOf).join(', ')}` : 'Unassigned'}
              </div>

              {/* Actions */}
              <div className="row" style={{ marginTop: '0.5rem', gap: '0.4rem', flexWrap: 'wrap' }}>
                {t.status === 'todo' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => run(api.startTask(id, t.id))}>
                    {t.requiresApproval ? 'Request to start' : 'Start'}
                  </button>
                )}
                {t.status === 'awaiting_approval' && project.isLead && (
                  <>
                    <button className="btn btn-approve btn-sm" onClick={() => run(api.approveTask(id, t.id, true))}>Approve start</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => run(api.approveTask(id, t.id, false))}>Send back</button>
                  </>
                )}
                {t.status === 'awaiting_approval' && !project.isLead && (
                  <span className="muted" style={{ fontSize: '0.78rem' }}>Waiting on lead approval…</span>
                )}
                {t.status === 'in_progress' && (
                  <button className="btn btn-approve btn-sm" onClick={() => run(api.completeTask(id, t.id, true))}>Mark done</button>
                )}
                {t.status === 'done' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => run(api.completeTask(id, t.id, false))}>Reopen</button>
                )}
                {/* Assign anyone on the team (toggles membership on the task). */}
                {team.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && run(api.assignTask(id, t.id, e.target.value))}
                    style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                  >
                    <option value="">Assign…</option>
                    {team.map((m) => (
                      <option key={m.id} value={m.id}>
                        {(t.assignedTo || []).includes(m.id) ? '(assigned) ' : ''}{m.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const CAL_TONE = { task: 'blue', paper: 'gold', event: 'gray', workshop: 'blue', meetup: 'blue' };

// Project-scoped calendar: this project's deadlines + dated task due-dates. The
// lead (or staff) can add events; everyone can RSVP to gatherings.
function ProjectCalendar({ project, onChange }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'event', dueAt: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.projectEvents(project.id).then(setItems).catch(() => setItems([])), [project.id]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.dueAt) return;
    setBusy(true);
    try {
      await api.addEvent({ ...form, projectId: project.id });
      setForm({ title: '', type: 'event', dueAt: '' });
      setAdding(false);
      toast.success('Added to the project calendar — your team has been notified');
      load();
      onChange();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const rsvp = (it) =>
    api.rsvpEvent(it.eventId, !it.going)
      .then(() => load())
      .catch((err) => toast.error(err.message));

  const remove = (it) =>
    api.deleteEvent(it.eventId).then(() => { toast.success('Removed'); load(); onChange(); }).catch((err) => toast.error(err.message));

  const upcoming = (items || []).filter((it) => it.date >= today());
  const past = (items || []).filter((it) => it.date < today());

  return (
    <Card>
      <div className="card-row">
        <h3 style={{ margin: 0 }}>Project calendar</h3>
        {project.isLead && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : '+ Add event'}</button>
        )}
      </div>
      <p className="muted" style={{ margin: '0.3rem 0 0' }}>Deadlines and meetings for this project. Task due-dates show up here automatically.</p>

      {adding && project.isLead && (
        <form onSubmit={add} className="info-block" style={{ marginTop: '0.6rem' }}>
          <Field label="What's happening?">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Team sync / Draft due" required />
          </Field>
          <div className="grid grid-2">
            <Field label="Type">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="event">Meeting / event</option>
                <option value="workshop">Workshop</option>
                <option value="meetup">Meetup</option>
                <option value="paper">Paper deadline</option>
                <option value="task">Task deadline</option>
              </select>
            </Field>
            <Field label="Date">
              <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} required />
            </Field>
          </div>
          <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Adding…' : 'Add to calendar'}</button>
        </form>
      )}

      {items === null ? (
        <p className="muted" style={{ marginTop: '0.6rem' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted" style={{ marginTop: '0.6rem' }}>Nothing scheduled yet.</p>
      ) : (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="muted label-up" style={{ marginBottom: '0.4rem' }}>Upcoming</div>
          {upcoming.length === 0 ? (
            <p className="muted" style={{ margin: '0 0 0.6rem' }}>No upcoming items.</p>
          ) : (
            <div className="stack">{upcoming.map((it) => <CalRow key={it.id} it={it} onRsvp={rsvp} onRemove={remove} />)}</div>
          )}
          {past.length > 0 && (
            <>
              <div className="muted label-up" style={{ margin: '0.9rem 0 0.4rem' }}>Past</div>
              <div className="stack">{past.map((it) => <CalRow key={it.id} it={it} onRsvp={rsvp} onRemove={remove} past />)}</div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function CalRow({ it, onRsvp, onRemove, past }) {
  const overdue = !past && it.kind === 'task' && it.date < today();
  return (
    <div className="info-block">
      <div className="card-row">
        <div>
          <strong>{it.title}</strong>
          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {fmtDate(it.date)}{it.byName ? ` · set by ${it.byName}` : ''}{it.rsvpable && it.rsvpCount > 0 ? ` · ${it.rsvpCount} going` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: '0.3rem' }}>
          {it.rsvpable && (
            <button className={`btn btn-sm ${it.going ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onRsvp(it)}>
              {it.going ? 'Going' : 'RSVP'}
            </button>
          )}
          <Badge tone={overdue ? 'red' : CAL_TONE[it.kind] || 'gray'}>{overdue ? 'overdue' : it.kind}</Badge>
          {it.canDelete && (
            <OverflowMenu label="Event options">
              <MenuItem onClick={() => onRemove(it)}>Remove from calendar</MenuItem>
            </OverflowMenu>
          )}
        </div>
      </div>
    </div>
  );
}

// Team roster with contact info + per-member roles. The lead can edit roles,
// invite by email, and one-click invite suggested teammates.
function TeamSection({ project, onChange }) {
  const id = project.id;
  const team = project.team || [];
  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card>
        <div className="card-row">
          <h3 style={{ margin: 0 }}>Team roster</h3>
          {team.length > 0 && (
            <a className="btn btn-ghost btn-sm" href={`mailto:${team.map((m) => m.email).filter(Boolean).join(',')}`}>Email all</a>
          )}
        </div>
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          {team.map((m) => (
            <div key={m.id} className="row" style={{ alignItems: 'flex-start', gap: '0.6rem' }}>
              <Pfp name={m.name} url={m.avatarUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <Link to={`/p/${m.slug || m.id}`}>{m.name}</Link>{' '}
                  {m.isLead && <Badge tone="gold">lead</Badge>}{' '}
                  {m.role && <Badge tone="blue">{m.role}</Badge>}
                </div>
                <div className="muted" style={{ fontSize: '0.78rem' }}>
                  {m.email && <a href={`mailto:${m.email}`}>{m.email}</a>}
                  {m.discord && <> · Discord: {m.discord}</>}
                </div>
                {project.isLead && <RoleEditor projectId={id} member={m} onChange={onChange} />}
              </div>
            </div>
          ))}
        </div>
        {project.isLead && <InviteByEmail projectId={id} invites={project.invites || []} onChange={onChange} />}
      </Card>

      {project.isLead && <SuggestedPeople projectId={id} onChange={onChange} />}
    </div>
  );
}

// Team brainstorm: anyone proposes ideas, everyone upvotes, the lead picks one.
function IdeasCard({ project, onChange }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ideas = [...(project.ideas || [])].sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0));

  const run = (p) => { setBusy(true); p.then(onChange).catch((e) => toast.error(e.message)).finally(() => setBusy(false)); };
  const add = (e) => { e.preventDefault(); if (text.trim()) { run(api.addIdea(project.id, text)); setText(''); } };

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Ideas board</h3>
      <p className="muted" style={{ margin: '0.2rem 0 0.6rem' }}>Propose ideas as a team, vote, then the lead picks the direction.</p>
      <div className="stack">
        {ideas.length === 0 && <p className="muted">No ideas yet — add the first one.</p>}
        {ideas.map((i) => (
          <div key={i.id} className="info-block">
            <div className="card-row">
              <div>{i.text} {i.chosen && <Badge tone="green">chosen</Badge>}</div>
              <div className="row" style={{ gap: '0.3rem' }}>
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(api.voteIdea(project.id, i.id))}>
                  ▲ {i.votes?.length || 0}
                </button>
                {project.isLead && !i.chosen && (
                  <button className="btn btn-approve btn-sm" disabled={busy} onClick={() => run(api.chooseIdea(project.id, i.id))}>Choose</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={add} className="row" style={{ marginTop: '0.6rem' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Propose a research idea…" />
        <button className="btn btn-primary btn-sm" disabled={busy}>Add</button>
      </form>
    </Card>
  );
}

// Links & resources with embedded previews (Drive / YouTube / PDF). Any member
// can add; any member can remove.
function LinksCard({ project, onChange }) {
  const toast = useToast();
  const [form, setForm] = useState({ label: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const links = project.links || [];

  const add = async (e) => {
    e.preventDefault();
    if (!form.url.trim()) return;
    setBusy(true);
    try {
      await api.addProjectLink(project.id, form);
      setForm({ label: '', url: '' });
      onChange();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (linkId) => {
    setDeleting(linkId);
    try { await api.deleteProjectLink(project.id, linkId); onChange(); }
    catch (err) { toast.error(err.message); }
    finally { setDeleting(null); }
  };

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Links &amp; resources</h3>
      <p className="muted" style={{ margin: '0.2rem 0 0' }}>GitHub, Google Drive, datasets, literature — anything the team needs. Drive, YouTube and PDF links preview inline.</p>
      {links.length === 0 && <p className="muted" style={{ marginTop: '0.5rem' }}>No links yet.</p>}
      <div className="stack" style={{ marginTop: '0.6rem' }}>
        {links.map((l) => (
          <div key={l.id} className="info-block">
            <div className="card-row">
              <a href={l.url} target="_blank" rel="noreferrer">{l.label || l.url}</a>
              <OverflowMenu label="Link options">
                <MenuItem disabled={deleting === l.id} onClick={() => remove(l.id)}>
                  {deleting === l.id ? 'Removing…' : 'Remove link'}
                </MenuItem>
              </OverflowMenu>
            </div>
            {embedSrc(l.url) && <Embed url={l.url} height={300} title={l.label || 'Embedded preview'} />}
          </div>
        ))}
      </div>
      <form onSubmit={add} style={{ marginTop: '0.75rem' }}>
        <input placeholder="Label (e.g. GitHub repo, Draft manuscript)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={{ marginBottom: '0.5rem' }} />
        <div className="row">
          <input placeholder="https://… (GitHub, Drive, YouTube, PDF, dataset)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
          <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </form>
    </Card>
  );
}

// Announcements: lead posts updates; everyone reads them (newest first).
function Announcements({ project, onChange }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const announcements = project.announcements || [];

  const post = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await api.addAnnouncement(project.id, { body }); setBody(''); toast.success('Announcement posted'); onChange(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <Card>
        <h3 style={{ marginTop: 0 }}>Announcements</h3>
        {announcements.length === 0 ? (
          <p className="muted">No announcements.</p>
        ) : (
          <div className="stack">
            {announcements.map((a) => (
              <div key={a.id} className="info-block">
                {a.body}
                <div className="muted" style={{ marginTop: '0.25rem', fontSize: '0.78rem' }}>{new Date(a.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {project.isLead && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Post an announcement</h3>
          <p className="muted" style={{ margin: '0.2rem 0 0.5rem' }}>Visible to everyone on the team; they also get a notification.</p>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Share an update with the team…" />
          <button className="btn btn-primary btn-sm" style={{ marginTop: '0.6rem' }} disabled={busy || !body.trim()} onClick={post}>
            {busy ? 'Posting…' : 'Post announcement'}
          </button>
        </Card>
      )}
    </div>
  );
}

// Lead sets a member's role (e.g. "Data Lead"); it shows on the roster and
// auto-appears on that member's public profile.
function RoleEditor({ projectId, member, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(member.role || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.setProjectRole(projectId, member.id, title.trim()); toast.success('Role updated'); setEditing(false); onChange(); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  if (!editing) {
    return (
      <div style={{ marginTop: '0.15rem' }}>
        <OverflowMenu label={`Options for ${member.name}`} align="left">
          <MenuItem onClick={() => { setTitle(member.role || ''); setEditing(true); }}>
            {member.role ? 'Edit role' : 'Set role'}
          </MenuItem>
        </OverflowMenu>
      </div>
    );
  }
  return (
    <div className="row" style={{ marginTop: '0.3rem', gap: '0.3rem' }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Data Lead, Writer" maxLength={60} style={{ maxWidth: 220 }} />
      <Button size="btn-sm" disabled={busy} onClick={save}>Save</Button>
      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );
}

// Lead-only: invite someone by email. Existing accounts join instantly; new
// emails get a register link and join automatically on sign-up.
function InviteByEmail({ projectId, invites, onChange }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const invite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      const r = await api.inviteToProject(projectId, email.trim());
      toast.success(r.status === 'added' ? `${r.name} added to the team` : `Invite sent to ${r.email}`);
      setEmail('');
      onChange();
    } catch (err) { toast.error(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
      <div className="field-label" style={{ marginBottom: '0.35rem' }}>Invite a teammate</div>
      <form className="row" onSubmit={invite} style={{ flexWrap: 'nowrap' }}>
        <input type="email" placeholder="Invite by email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button size="btn-sm" disabled={busy}>{busy ? '…' : 'Invite'}</Button>
      </form>
      {invites.length > 0 && (
        <div className="muted" style={{ marginTop: '0.45rem', fontSize: '0.78rem' }}>
          Waiting on: {invites.map((i) => i.email).join(', ')} — they'll join automatically when they sign up.
        </div>
      )}
    </div>
  );
}

// Suggested teammates ranked by shared interests — the lead invites with one click.
function SuggestedPeople({ projectId, onChange }) {
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [busyId, setBusyId] = useState('');
  const load = useCallback(() => api.suggestedForProject(projectId).then(setPeople).catch(() => setPeople([])), [projectId]);
  useEffect(() => { load(); }, [load]);

  const invite = async (person) => {
    setBusyId(person.id);
    try { await api.inviteMemberById(projectId, person.id); toast.success(`${person.name} added to the project`); load(); onChange(); }
    catch (e) { toast.error(e.message); }
    finally { setBusyId(''); }
  };

  if (!people) return null;
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Suggested people</h3>
      <p className="muted" style={{ margin: '0.2rem 0 0.6rem' }}>Researchers whose interests match this project. Invite them to your team.</p>
      {people.length === 0 ? (
        <p className="muted">No interest matches yet — try the Research Hub to recruit, or fill in your project's category.</p>
      ) : (
        <div className="stack">
          {people.map((p) => (
            <div key={p.id} className="info-block">
              <div className="card-row">
                <div>
                  <Link to={`/p/${p.slug || p.id}`}><strong>{p.name}</strong></Link>{' '}
                  <span className="muted" style={{ fontSize: '0.78rem' }}>{p.role}{p.institution ? ` · ${p.institution}` : ''}</span>
                  {p.blurb && <div className="muted" style={{ fontSize: '0.82rem' }}>{p.blurb}</div>}
                  <div className="row" style={{ gap: '0.3rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                    {(p.shared || []).slice(0, 4).map((i) => <Badge key={i} tone="green">{i}</Badge>)}
                  </div>
                </div>
                <Button size="btn-sm" disabled={busyId === p.id} onClick={() => invite(p)}>{busyId === p.id ? 'Inviting…' : 'Invite'}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
