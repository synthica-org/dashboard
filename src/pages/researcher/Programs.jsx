import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, Badge, Button, EmptyState } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import Icon from '../../components/Icon.jsx';

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const daysLeft = (iso) => Math.ceil((new Date(iso) - Date.now()) / 86400000);

// Structured programs: apply → join the cohort → track milestones together.
export default function Programs({ embedded }) {
  const [programs, setPrograms] = useState(null);
  const toast = useToast();

  const load = () => api.programs().then(setPrograms).catch(() => setPrograms([]));
  useEffect(() => { load(); }, []);

  const apply = async (p) => {
    try {
      await api.applyProgram(p.id, '');
      toast.success(`Applied to ${p.title} — you'll hear back soon!`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  if (!programs) return <div className="page-loading">Loading…</div>;

  return (
    <div>
      {!embedded && <h1 className="page-title">Programs</h1>}
      {!embedded && <p className="page-sub">Structured cohorts with mentors, deadlines, and milestones — apply with one click.</p>}
      {programs.length === 0 && <EmptyState>No programs are open right now — check back soon.</EmptyState>}
      <div className="grid grid-2">
        {programs.map((p) => {
          const dl = p.applyDeadline ? daysLeft(p.applyDeadline) : null;
          const doneCount = p.milestones.filter((m) => m.done).length;
          return (
            <Card key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{p.title}</h3>
                  <div className="row" style={{ gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                    {p.cohortLabel && <Badge>{p.cohortLabel}</Badge>}
                    {p.category && <Badge tone="gray">{p.category}</Badge>}
                    <Badge tone={p.status === 'open' ? 'green' : 'gray'}>{p.status}</Badge>
                    {p.myStatus === 'member' && <Badge tone="green"><span className="icon-label"><Icon name="party" size={12} /> you're in</span></Badge>}
                    {p.myStatus === 'applied' && <Badge tone="gold">application pending</Badge>}
                  </div>
                </div>
              </div>
              <p style={{ margin: '0.7rem 0' }}>{p.description}</p>
              <p className="login-hint" style={{ margin: '0 0 0.7rem' }}>
                {p.startAt && <>Runs {fmtDay(p.startAt)} → {fmtDay(p.endAt)} · </>}
                {p.spots ? `${p.cohortSize}/${p.spots} spots filled` : `${p.cohortSize} members`}
                {p.applyDeadline && p.status === 'open' && <> · apply by {fmtDay(p.applyDeadline)}{dl >= 0 && <strong> ({dl} day{dl === 1 ? '' : 's'} left)</strong>}</>}
              </p>

              {p.milestones.length > 0 && (
                <div style={{ marginBottom: '0.8rem' }}>
                  <div className="field-label">Milestones · {doneCount}/{p.milestones.length} complete</div>
                  <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
                    {p.milestones.map((m) => (
                      <li key={m.id} style={{ opacity: m.done ? 0.65 : 1 }}>
                        <span className="icon-label"><Icon name={m.done ? 'check-square' : 'square'} size={16} /> {m.title}</span>{m.dueAt && <span className="login-hint"> — {fmtDay(m.dueAt)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {p.myStatus === 'none' && p.status === 'open' && (
                <Button onClick={() => apply(p)}>Apply to join →</Button>
              )}
              {p.myStatus === 'rejected' && <p className="login-hint">Your last application wasn't accepted — new cohorts open regularly.</p>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
