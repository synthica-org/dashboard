import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Badge, Button, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';

// Derive a friendly status + progress from a project's tasks (there's no
// persisted status field on a project).
function progressOf(p) {
  const tasks = p.tasks || [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done' || t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const status = total === 0 ? { label: 'Getting started', tone: 'gray' }
    : pct === 100 ? { label: 'Complete', tone: 'green' }
      : done > 0 ? { label: 'In progress', tone: 'blue' }
        : { label: 'Just kicked off', tone: 'gold' };
  return { total, done, pct, status };
}

// My Projects (ROLE_WORKFLOWS §6.1): projects the user leads and projects they're
// a member of, each with status, member count, and task progress. Leads also see
// applicants to their listings here.
export default function MyProjects() {
  const { user } = useAuth();
  const isIndependent = (user?.tags || []).includes('independent_researcher');
  const [projects, setProjects] = useState(null);
  useEffect(() => { api.myProjects().then(setProjects).catch(() => setProjects([])); }, []);

  const led = (projects || []).filter((p) => p.leadId === user?.id);
  const member = (projects || []).filter((p) => p.leadId !== user?.id);

  return (
    <div>
      <div className="card-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">My Projects</h1>
          <p className="page-sub">Projects you lead and projects you've joined — all in one place.</p>
        </div>
        {isIndependent && <Link className="btn btn-primary btn-sm" to="/researcher/independent" style={{ flex: 'none' }}>+ Add a project</Link>}
      </div>

      <Applicants />

      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <EmptyState>You're not on any projects yet — find one in <Link to="/researcher/opportunities">Opportunities</Link>.</EmptyState>
      ) : (
        <>
          <ProjectSection
            title="Projects you lead"
            count={led.length}
            projects={led}
            empty={<>You don't lead any projects yet. Leads can start one from <Link to="/researcher/opportunities">Opportunities</Link>.</>}
          />
          <ProjectSection
            title="Projects you're a member of"
            count={member.length}
            projects={member}
            empty="You haven't joined anyone else's project yet."
          />
        </>
      )}
    </div>
  );
}

function ProjectSection({ title, count, projects, empty }) {
  return (
    <section style={{ marginTop: '1.75rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>
        {title} <Badge tone="gray">{count}</Badge>
      </h2>
      {projects.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{empty}</p>
      ) : (
        <div className="grid grid-3">
          {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </section>
  );
}

function ProjectCard({ project }) {
  const { total, done, pct, status } = progressOf(project);
  return (
    <Link to={`/researcher/project/${project.id}`} style={{ color: 'inherit' }}>
      <Card className="paper-card">
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
          <Badge>{project.category || 'Uncategorized'}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <h3 style={{ margin: '0.6rem 0 0.3rem' }}>{project.title}</h3>
        <p className="paper-meta" style={{ margin: 0 }}>
          {(project.members || []).length} member{(project.members || []).length === 1 ? '' : 's'} · {total} task{total === 1 ? '' : 's'}
        </p>
        <div className="progress" style={{ margin: '0.6rem 0 0.3rem' }}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>{done}/{total} tasks complete ({pct}%)</p>
        <span className="label-up" style={{ display: 'inline-block', marginTop: '0.6rem' }}>Open project →</span>
      </Card>
    </Link>
  );
}

// Applicants to the lead's own listings — accept or reject. Renders nothing for
// non-leads or when there are no applicants.
function Applicants() {
  const toast = useToast();
  const [apps, setApps] = useState([]);
  const load = useCallback(() => api.listingApplications().then(setApps).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const review = (a, status) => api.reviewListingApplication(a.id, status).then(() => { toast.success(`Applicant ${status}`); load(); }).catch((e) => toast.error(e.message));
  if (!apps.length) return null;
  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Applicants to your listings <Badge tone="gray">{apps.filter((a) => a.status === 'pending').length} pending</Badge></h2>
      <div className="stack">
        {apps.map((a) => (
          <Card key={a.id}>
            <div className="card-row">
              <div>
                <strong>{a.userName}</strong>
                {a.message && <div className="muted" style={{ marginTop: '0.2rem' }}>{a.message}</div>}
                {a.resumeUrl && <a href={a.resumeUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem' }}>résumé</a>}
              </div>
              <div className="row">
                {a.status === 'pending' ? (
                  <>
                    <Button variant="approve" size="btn-sm" onClick={() => review(a, 'approved')}>Accept</Button>
                    <Button variant="reject" size="btn-sm" onClick={() => review(a, 'rejected')}>Reject</Button>
                  </>
                ) : <Badge tone={a.status === 'approved' ? 'green' : 'red'}>{a.status}</Badge>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
