import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api.js';
import { Card, Badge, Button } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';

// Researcher tags a moderator can grant. Mirrors backend RESEARCHER_TAGS.
const TAGS = ['associate_researcher', 'lead_researcher', 'chapter_leader', 'independent_researcher'];
const TAG_LABELS = {
  associate_researcher: 'Associate Researcher',
  lead_researcher: 'Lead Researcher',
  chapter_leader: 'Chapter Leader',
  independent_researcher: 'Independent Researcher',
};

// The moderator desk is one screen of gatekeeping queues. Onboarding and role
// applications share a single `/admin/applications` fetch (one list, two views);
// the other queues own their own load/refresh.
export default function ModeratorConsole() {
  const toast = useToast();
  const [apps, setApps] = useState(null);
  const loadApps = useCallback(() => { api.adminApplications().then(setApps).catch(() => setApps([])); }, []);
  useEffect(() => { loadApps(); }, [loadApps]);

  const reviewApp = (id, status, assignTag) =>
    api.reviewApplication(id, status, assignTag)
      .then(() => { toast.success(`Application ${status}`); loadApps(); })
      .catch((e) => toast.error(e.message));

  return (
    <div>
      <h1 className="page-title">Moderator desk</h1>
      <p className="page-sub">
        This is the moderator desk — approve new members, role upgrades, project proposals, and archive
        submissions, and (re)assign researcher tags. Every decision notifies the applicant.
      </p>

      <OnboardingQueue apps={apps} review={reviewApp} />
      <RoleApplicationsQueue apps={apps} review={reviewApp} />
      <ProposalsQueue />
      <ArchiveQueue />
      <TagAssignment />
    </div>
  );
}

// --- small shared bits ------------------------------------------------------

// Section heading with a brand-tinted icon chip, a pending-count badge, and a
// one-line "what this queue is for" caption — keeps the whole desk self-explanatory.
function QueueHeading({ icon, title, count, hint, children }) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <div className="card-row" style={{ marginBottom: hint ? '0.15rem' : 0, flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', minWidth: 0 }}>
          <span className="guide-ico" aria-hidden="true"><Icon name={icon} size={18} /></span>
          {title}{' '}
          {typeof count === 'number' && <Badge tone={count > 0 ? 'gold' : 'gray'}>{count} pending</Badge>}
        </h2>
        {children}
      </div>
      {hint && <p className="muted" style={{ margin: 0 }}>{hint}</p>}
    </div>
  );
}

// The recommended-role hint shown on onboarding/role rows. Optional — only an aid.
function RecommendationHint({ recommendation }) {
  if (!recommendation) return null;
  return (
    <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
      <Badge tone="gold">Suggested: {recommendation.label}</Badge>{' '}
      <span className="muted">{recommendation.reason}</span>
    </div>
  );
}

// --- 1. New member onboarding ----------------------------------------------

function OnboardingQueue({ apps, review }) {
  const rows = (apps || []).filter((a) => a.kind === 'onboarding' && a.status === 'pending');

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <QueueHeading
        icon="user-plus"
        title="New member onboarding"
        count={apps ? rows.length : undefined}
        hint="Review a sign-up's profile and signals, then approve with a starting tag (default Associate) or reject with a reason."
      />
      {apps === null ? (
        <Card><p className="muted" style={{ margin: 0 }}>Loading…</p></Card>
      ) : rows.length === 0 ? (
        <Card><p className="muted icon-label" style={{ margin: 0 }}><Icon name="check-circle" size={14} /> No new members waiting.</p></Card>
      ) : (
        <div className="stack">{rows.map((a) => <OnboardingRow key={a.id} a={a} review={review} />)}</div>
      )}
    </section>
  );
}

function OnboardingRow({ a, review }) {
  const [tag, setTag] = useState(a.recommendation?.tag || 'associate_researcher');
  const reject = () => { if (window.confirm(`Reject ${a.userName}'s membership? They'll be notified.`)) review(a.id, 'rejected'); };
  return (
    <Card>
      <div className="card-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <strong>{a.userName}</strong> <Badge tone="gray">new member</Badge>
          {a.resumeUrl
            ? <> · <a href={a.resumeUrl} target="_blank" rel="noreferrer">résumé</a></>
            : <> · <span className="muted" style={{ fontSize: '0.8rem' }}>no résumé</span></>}
          <div className="info-block" style={{ marginTop: '0.4rem' }}>
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              Research {a.researchExperience ?? '—'}/10 · Leadership {a.leadershipExperience ?? '—'}/10
              {a.wantsChapterLead ? ' · wants to lead a chapter' : ''}{a.gpa ? ` · GPA ${a.gpa}` : ''}
            </div>
            {a.experienceSummary && (
              <div style={{ fontSize: '0.82rem', marginTop: '0.3rem', color: 'var(--slate)' }}>“{a.experienceSummary}”</div>
            )}
            {a.priorLead && a.legacyProject?.title && (
              <div style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                <Badge tone="gold">Returning lead</Badge>{' '}
                <span className="muted">Claims project “{a.legacyProject.title}” ({a.legacyProject.category || 'no subject'}) — approving as Lead restores it.</span>
              </div>
            )}
            <RecommendationHint recommendation={a.recommendation} />
          </div>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }}>Applied {new Date(a.at).toLocaleDateString()}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: '0.6rem' }}>
        <label className="muted" style={{ fontSize: '0.8rem' }}>Starting tag</label>
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} title="Tag granted on approval">
          {TAGS.map((t) => <option key={t} value={t}>{TAG_LABELS[t]}</option>)}
        </select>
        <Button variant="approve" className="btn-sm" onClick={() => review(a.id, 'approved', tag)}>Approve</Button>
        <Button variant="reject" className="btn-sm" onClick={reject}>Reject</Button>
      </div>
    </Card>
  );
}

// --- 2. Role upgrade applications -------------------------------------------

function RoleApplicationsQueue({ apps, review }) {
  // Role + project applications from the Application Hub (anything that isn't an
  // onboarding sign-up or a program cohort admission — those have their own desks).
  const rows = (apps || []).filter((a) => a.kind !== 'onboarding' && a.kind !== 'program' && a.status === 'pending');

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <QueueHeading
        icon="graduation-cap"
        title="Role upgrade applications"
        count={apps ? rows.length : undefined}
        hint="Lead, Independent, and Chapter Leader requests. Approving adds the tag (and unlocks the matching workspace + certificate)."
      />
      {apps === null ? (
        <Card><p className="muted" style={{ margin: 0 }}>Loading…</p></Card>
      ) : rows.length === 0 ? (
        <Card><p className="muted" style={{ margin: 0 }}>No role applications waiting.</p></Card>
      ) : (
        <div className="stack">{rows.map((a) => <RoleRow key={a.id} a={a} review={review} />)}</div>
      )}
    </section>
  );
}

function RoleRow({ a, review }) {
  // If the application names a role it maps to a tag automatically; otherwise let
  // the moderator pick one (e.g. a bare project application).
  const [tag, setTag] = useState(a.recommendation?.tag || 'lead_researcher');
  const assignable = !a.role;
  const reject = () => { if (window.confirm(`Reject ${a.userName}'s ${a.role || 'application'}? They'll be notified.`)) review(a.id, 'rejected'); };
  return (
    <Card>
      <div className="card-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <strong>{a.userName}</strong> — {a.role || 'project application'}
          {a.assignedTag && <> · <Badge tone="green">{a.assignedTag}</Badge></>}
          {a.resumeUrl && <> · <a href={a.resumeUrl} target="_blank" rel="noreferrer">résumé</a></>}
          <RecommendationHint recommendation={a.recommendation} />
          {a.answers && (
            <details style={{ marginTop: '0.4rem' }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>View application</summary>
              <div className="stack" style={{ marginTop: '0.3rem' }}>
                {Object.entries(a.answers).map(([k, v]) => v && (
                  <div key={k} className="muted" style={{ fontSize: '0.8rem' }}><strong>{k}:</strong> {v}</div>
                ))}
              </div>
            </details>
          )}
          {a.message && !a.answers && <div className="muted" style={{ marginTop: '0.2rem' }}>{a.message}</div>}
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>Applied {new Date(a.at).toLocaleDateString()}</div>
        </div>
      </div>
      <div className="row" style={{ marginTop: '0.6rem' }}>
        {assignable && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} title="Tag granted on approval">
            {TAGS.map((t) => <option key={t} value={t}>{TAG_LABELS[t]}</option>)}
          </select>
        )}
        <Button variant="approve" className="btn-sm" onClick={() => review(a.id, 'approved', assignable ? tag : undefined)}>Approve</Button>
        <Button variant="reject" className="btn-sm" onClick={reject}>Reject</Button>
      </div>
    </Card>
  );
}

// --- 3. Independent project proposals (Unit 6) ------------------------------

function ProposalsQueue() {
  const toast = useToast();
  // `null` = loading, `undefined` = endpoint not available (Unit 6 not merged).
  const [proposals, setProposals] = useState(null);
  const load = useCallback(() => {
    if (typeof api.adminProposals !== 'function') { setProposals(undefined); return; }
    api.adminProposals()
      .then((list) => setProposals(Array.isArray(list) ? list : []))
      .catch(() => setProposals(undefined)); // treat a missing route as "coming soon"
  }, []);
  useEffect(() => { load(); }, [load]);

  const review = (id, status, feedback) =>
    api.reviewProposal(id, status, feedback)
      .then(() => { toast.success(status === 'approved' ? 'Project created' : 'Proposal returned'); load(); })
      .catch((e) => toast.error(e.message));

  const rows = (Array.isArray(proposals) ? proposals : []).filter((p) => (p.status || 'pending') === 'pending');

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <QueueHeading
        icon="clipboard"
        title="Independent project proposals"
        count={Array.isArray(proposals) ? rows.length : undefined}
        hint="Approve a submitted research proposal to create the project, or return it with feedback so the researcher can resubmit."
      />
      {proposals === null ? (
        <Card><p className="muted" style={{ margin: 0 }}>Loading…</p></Card>
      ) : proposals === undefined ? (
        <Card>
          <p className="muted" style={{ margin: 0 }}>
            <Icon name="sparkles" size={14} className="inline-ico" /> <strong>Coming soon</strong> — the independent-proposals workflow isn't enabled on this backend yet.
            Approved Independent Researchers will submit proposals here for review.
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card><p className="muted" style={{ margin: 0 }}>No proposals waiting.</p></Card>
      ) : (
        <div className="stack">{rows.map((p) => <ProposalRow key={p.id} p={p} review={review} />)}</div>
      )}
    </section>
  );
}

function ProposalRow({ p, review }) {
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');
  return (
    <Card>
      <div style={{ minWidth: 0 }}>
        <strong>{p.title || 'Untitled proposal'}</strong>
        {p.category && <> <Badge tone="gray">{p.category}</Badge></>}
        <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}>
          by {p.userName || p.authorName || 'member'}{p.at ? ` · ${new Date(p.at).toLocaleDateString()}` : ''}
        </div>
        {p.description && <p style={{ fontSize: '0.88rem', margin: '0.45rem 0 0' }}>{p.description}</p>}
        {p.methodology && (
          <p className="muted" style={{ fontSize: '0.82rem', margin: '0.35rem 0 0' }}><strong>Methodology:</strong> {p.methodology}</p>
        )}
      </div>
      {rejecting ? (
        <div className="row" style={{ marginTop: '0.6rem', gap: '0.4rem' }}>
          <input
            autoFocus
            placeholder="Feedback so they can revise & resubmit"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
          <Button variant="reject" className="btn-sm" onClick={() => review(p.id, 'rejected', feedback)}>Return for revision</Button>
          <Button variant="ghost" className="btn-sm" onClick={() => { setRejecting(false); setFeedback(''); }}>Cancel</Button>
        </div>
      ) : (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <Button variant="approve" className="btn-sm" onClick={() => review(p.id, 'approved')}>Approve &amp; create project</Button>
          <Button variant="reject" className="btn-sm" onClick={() => setRejecting(true)}>Return for revision</Button>
        </div>
      )}
    </Card>
  );
}

// --- 4. Archive verification ------------------------------------------------

function ArchiveQueue() {
  const toast = useToast();
  const [queue, setQueue] = useState(null);
  const load = useCallback(() => { api.adminArchiveQueue().then(setQueue).catch(() => setQueue([])); }, []);
  useEffect(() => { load(); }, [load]);

  const verify = (id, status) =>
    api.verifyPublication(id, status)
      .then(() => { toast.success(status === 'approved' ? 'Paper verified' : 'Paper rejected'); load(); })
      .catch((e) => toast.error(e.message));

  const rows = queue || [];
  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <QueueHeading
        icon="books"
        title="Archive verification"
        count={queue ? rows.length : undefined}
        hint="Self-archived papers stay hidden until you verify them. Verify to publish to the public archive, or reject."
      />
      {queue === null ? (
        <Card><p className="muted" style={{ margin: 0 }}>Loading…</p></Card>
      ) : rows.length === 0 ? (
        <Card><p className="muted" style={{ margin: 0 }}>No papers awaiting verification.</p></Card>
      ) : (
        <div className="stack">
          {rows.map((p) => (
            <Card key={p.id}>
              <div className="card-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong>{p.title}</strong>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {(p.authors || []).map((au) => au.name).join(', ')} · {p.category}{p.publishedAt ? ` · ${p.publishedAt}` : ''}
                  </div>
                  {p.pdfUrl && <a href={p.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem' }}>PDF / source</a>}
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <Button variant="approve" className="btn-sm" onClick={() => verify(p.id, 'approved')}>Verify</Button>
                  <Button variant="reject" className="btn-sm" onClick={() => verify(p.id, 'rejected')}>Reject</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

// --- 5. Tag (re)assignment --------------------------------------------------

function TagAssignment() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [visible, setVisible] = useState(5);

  const search = useCallback((query) => api.adminUsers(query).then(setUsers).catch(() => setUsers([])), []);
  useEffect(() => { search(''); }, [search]);

  const onSearch = (query) => { setQ(query); setVisible(5); search(query); };
  const addTag = (u, tag) =>
    api.adminSetTags(u.id, { addTags: [tag] })
      .then(() => { toast.success(`${u.name} → ${TAG_LABELS[tag] || tag}`); search(q); })
      .catch((e) => toast.error(e.message));
  const removeTag = (u, tag) =>
    api.adminSetTags(u.id, { removeTags: [tag] }).then(() => search(q)).catch((e) => toast.error(e.message));

  const researchers = users.filter((u) => u.kind === 'researcher');

  return (
    <section style={{ marginBottom: '1.75rem' }}>
      <QueueHeading
        icon="tags"
        title="Tag (re)assignment"
        hint="Search members and adjust their researcher tags directly — granting a tag also activates a pending account."
      />
      <Card>
        <div className="card-row">
          <h3 style={{ margin: 0 }}>Find a member</h3>
          <input
            placeholder="Search name / email / username"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          {researchers.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No members match.</p>
          ) : researchers.slice(0, visible).map((u) => (
            <div key={u.id} className="info-block">
              <div className="card-row">
                <div style={{ minWidth: 0 }}>
                  <strong>{u.name}</strong>{' '}
                  {!u.approved && <Badge tone="gold">pending approval</Badge>}{' '}
                  {u.suspended && <Badge tone="red">suspended</Badge>}
                  <div className="muted" style={{ fontSize: '0.78rem' }}>{u.email}</div>
                  {u.recommendation && !(u.tags || []).includes(u.recommendation.tag) && (
                    <div style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      <Badge tone="gold">Suggested: {u.recommendation.label}</Badge>{' '}
                      <span className="muted">{u.recommendation.reason}</span>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: '0.3rem' }}>
                    {(u.tags || []).length === 0
                      ? <span className="muted" style={{ fontSize: '0.78rem' }}>no tags yet</span>
                      : (u.tags || []).map((t) => (
                        <button
                          key={t}
                          className="badge badge-blue"
                          style={{ cursor: 'pointer', border: 'none' }}
                          title="Click to remove"
                          aria-label={`Remove ${TAG_LABELS[t] || t} tag`}
                          onClick={() => removeTag(u, t)}
                        >
                          {TAG_LABELS[t] || t} <Icon name="x" size={10} />
                        </button>
                      ))}
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: '0.4rem' }}>
                <select defaultValue="" onChange={(e) => { if (e.target.value) { addTag(u, e.target.value); e.target.value = ''; } }} style={{ width: 'auto' }}>
                  <option value="">+ add tag…</option>
                  {TAGS.filter((t) => !(u.tags || []).includes(t)).map((t) => <option key={t} value={t}>{TAG_LABELS[t]}</option>)}
                </select>
                {u.recommendation && !(u.tags || []).includes(u.recommendation.tag) && (
                  <Button className="btn-sm" variant="ghost" onClick={() => addTag(u, u.recommendation.tag)}>Apply suggestion</Button>
                )}
              </div>
            </div>
          ))}
          {researchers.length > visible && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setVisible((c) => Math.min(c + 5, researchers.length))}
              style={{ marginTop: '0.5rem', width: '100%' }}
            >
              Show more ({researchers.length - visible} remaining)
            </button>
          )}
        </div>
      </Card>
    </section>
  );
}
