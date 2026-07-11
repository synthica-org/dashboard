// Chapter Leader workspace — a dedicated, Google-Classroom-style home for
// running a local Synthica chapter (ROLE_WORKFLOWS.md §8).
//
// Leaders see: the chapter identity, a prominent copyable 8-char join code (with
// regenerate), a stats dashboard, the live member roster with onboarding
// progress, an announcements feed, and an "onboard by email" tool.
//
// Non-leaders who land here get the member-facing "Join a chapter" panel: enter
// a code → join → see the chapter feed + their onboarding checklist.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth } from '../../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../components/toast.jsx';

// --- shared building blocks (local, self-contained) -------------------------

// Hero banner that headlines the workspace and explains the role in one line.
function DashboardHero({ badge, title, subtitle, children }) {
  return (
    <div className="hero-card hero-card--chapter" style={{ marginBottom: '1.5rem' }}>
      <div className="hero-eyebrow">{badge}</div>
      <h1 className="page-title" style={{ margin: '0.4rem 0 0.2rem' }}>{title}</h1>
      {subtitle && <p style={{ margin: 0, maxWidth: '52ch' }}>{subtitle}</p>}
      {children && <div style={{ marginTop: '0.9rem' }}>{children}</div>}
    </div>
  );
}

// A compact "how this works" guide so a first-time leader knows what to do.
function RoleGuide({ steps }) {
  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <div className="section-badge">How your chapter works</div>
      <ol style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.8 }}>
        {steps.map((s, i) => (
          <li key={i}><strong>{s.title}.</strong> <span className="muted">{s.body}</span></li>
        ))}
      </ol>
    </Card>
  );
}

function Stat({ label, value, hint }) {
  return (
    <Card>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--ink)' }}>{value}</div>
      <div className="muted">{label}</div>
      {hint && <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.15rem' }}>{hint}</div>}
    </Card>
  );
}

// --- join code card (leader) -----------------------------------------------

function JoinCodeCard({ code, onRegenerated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success('Join code copied');
    } catch {
      toast.info(`Your join code is ${code}`);
    }
  };

  const regenerate = async () => {
    if (!window.confirm('Generate a new join code? The current code will stop working immediately.')) return;
    setBusy(true);
    try {
      await api.regenerateChapterCode();
      onRegenerated();
      toast.success('New join code generated');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: '1.1rem' }}>
      <div className="card-row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="section-badge">Join code</div>
          <p className="muted" style={{ margin: '0.5rem 0 0.6rem', maxWidth: '40ch' }}>
            Share this 8-character code so students can join your chapter. Chapters are private — only people with the code can join.
          </p>
          <div
            aria-label="Chapter join code"
            style={{
              display: 'inline-block', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '2rem', fontWeight: 800, letterSpacing: '0.3rem',
              padding: '0.5rem 1rem', borderRadius: 12, background: 'var(--surface-2, #f1f5f3)',
              border: '1px dashed var(--border, #cbd5d0)', color: 'var(--brand-deep, #0b3d2e)',
            }}
          >
            {code}
          </div>
        </div>
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button className="btn-sm" onClick={copy}><Icon name="clipboard" size={15} /> Copy code</Button>
          <Button variant="ghost" className="btn-sm" disabled={busy} onClick={regenerate}>{busy ? '…' : '↻ Regenerate'}</Button>
        </div>
      </div>
    </Card>
  );
}

// --- announcements (leader posts; members get notified) ---------------------

function ChapterAnnouncements({ chapter, onPosted }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.chapterAnnounce(form);
      setForm({ title: '', body: '' });
      setOpen(false);
      toast.success('Announcement sent to all members');
      onPosted();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginBottom: '1.1rem' }}>
      <div className="card-row">
        <h3 style={{ margin: 0 }}>Announcements</h3>
        <Button className="btn-sm" onClick={() => setOpen((o) => !o)}>{open ? 'Cancel' : <><Icon name="megaphone" size={15} /> Post announcement</>}</Button>
      </div>
      {open && (
        <form onSubmit={send} style={{ marginTop: '0.6rem' }}>
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Chapter meeting Friday" required /></Field>
          <Field label="Message"><textarea rows={2} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Library room B, 4pm — bring your drafts!" /></Field>
          <Button type="submit" className="btn-sm" disabled={busy}>{busy ? 'Sending…' : 'Send to all members'}</Button>
          <span className="muted" style={{ marginLeft: '0.6rem', fontSize: '0.78rem' }}>Everyone in the chapter gets a notification + feed post.</span>
        </form>
      )}
      {(chapter.announcements || []).length > 0 ? (
        <div className="stack" style={{ marginTop: '0.7rem' }}>
          {chapter.announcements.slice(0, 6).map((a) => (
            <div key={a.id} className="info-block">
              <strong>{a.title}</strong>
              {a.body && <p className="muted" style={{ margin: '0.2rem 0 0' }}>{a.body}</p>}
              <div className="muted" style={{ fontSize: '0.72rem', marginTop: '0.2rem' }}>{a.byName ? `${a.byName} · ` : ''}{new Date(a.at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ marginTop: '0.7rem' }}>No announcements yet — post one to reach every member.</p>
      )}
    </Card>
  );
}

// --- member roster (names, emails, onboarding %, projects) ------------------

function MemberRoster({ chapter, onChanged }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', discord: '' });
  const [busy, setBusy] = useState(false);

  const addMember = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.addChapterMember(form);
      setForm({ name: '', email: '', discord: '' });
      setAdding(false);
      toast.success(r.existing ? `Added ${r.name} to the chapter` : `Created an account for ${r.name} and added them`);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="card-row">
        <h3 style={{ margin: 0 }}>Member roster <span className="muted" style={{ fontWeight: 400 }}>({chapter.members.length})</span></h3>
        <Button className="btn-sm" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : <><Icon name="plus" size={15} /> Onboard a member</>}</Button>
      </div>

      {adding && (
        <form onSubmit={addMember} className="info-block" style={{ marginTop: '0.75rem' }}>
          <Field label="Member email (required)">
            <input type="email" placeholder="student@school.edu" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <div className="grid grid-2">
            <Field label="Full name (only if new)">
              <input placeholder="Alex Doe" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Discord (optional)">
              <input placeholder="alexdoe" value={form.discord} onChange={(e) => setForm({ ...form, discord: e.target.value })} />
            </Field>
          </div>
          <Button type="submit" className="btn-sm" disabled={busy}>{busy ? 'Adding…' : 'Add to chapter'}</Button>
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            If they already have a Synthica account, we link it by email. Otherwise we create one and tag them as an Associate Researcher.
          </p>
        </form>
      )}

      <div className="stack" style={{ marginTop: '0.75rem' }}>
        {chapter.members.map((m) => (
          <div key={m.userId} className="info-block">
            <div className="card-row">
              <div style={{ minWidth: 0 }}>
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
              <div style={{ minWidth: 130 }}>
                <div className="muted" style={{ fontSize: '0.72rem', textAlign: 'right' }}>Onboarding {m.onboardingPct}%</div>
                <div className="progress"><span style={{ width: `${m.onboardingPct}%` }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- leader view -----------------------------------------------------------

function LeaderDashboard({ chapter, reload }) {
  const s = chapter.stats;

  return (
    <div>
      <DashboardHero
        badge="Chapter Leader"
        title={chapter.name}
        subtitle="Run your local Synthica chapter — share your join code, onboard members, and keep everyone moving with announcements and progress tracking."
      >
        <span className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {chapter.location && <Badge tone="gray"><Icon name="map-pin" size={11} /> {chapter.location}</Badge>}
          {chapter.handbookUrl && (
            <a className="btn btn-ghost btn-sm" href={chapter.handbookUrl} target="_blank" rel="noreferrer" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'transparent' }}>
              Chapter handbook
            </a>
          )}
        </span>
      </DashboardHero>

      <RoleGuide steps={[
        { title: 'Share your code', body: 'Give the 8-character join code to students in person or by email.' },
        { title: 'Track onboarding', body: 'Each member works through a checklist — watch the roster fill up to 100%.' },
        { title: 'Keep in touch', body: 'Post announcements; every member gets a notification and a feed post.' },
      ]} />

      <JoinCodeCard code={chapter.joinCode} onRegenerated={reload} />

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', marginBottom: '1.1rem' }}>
        <Stat label="Members" value={s.members} />
        <Stat label="Fully onboarded" value={`${s.fullyOnboarded}/${s.members}`} />
        <Stat label="Avg onboarding" value={`${s.avgOnboarding}%`} />
        <Stat label="Active projects" value={s.activeProjects} hint="across all members" />
      </div>

      <ChapterAnnouncements chapter={chapter} onPosted={reload} />
      <MemberRoster chapter={chapter} onChanged={reload} />
    </div>
  );
}

// --- member view: join by code + onboarding checklist -----------------------

function OnboardingChecklist({ ob, onChange }) {
  const toggle = (key, done) =>
    api.onboardingStep(key, done).then((r) => onChange({ ...ob, steps: r.steps, pct: r.pct }));
  return (
    <Card>
      <div className="card-row">
        <div>
          <h3 style={{ margin: 0 }}>{ob.pct === 100 ? "You're all set" : 'Your onboarding'} · {ob.chapterName}</h3>
          <p className="muted" style={{ margin: '0.2rem 0 0' }}>Onboarding {ob.pct}% complete</p>
        </div>
        {ob.handbookUrl && (
          <a className="btn btn-ghost btn-sm" href={ob.handbookUrl} target="_blank" rel="noreferrer">Chapter handbook</a>
        )}
      </div>
      <div className="progress" style={{ margin: '0.6rem 0 0.9rem' }}><span style={{ width: `${ob.pct}%` }} /></div>
      {ob.steps.map((step) => (
        <div key={step.key} className={`checklist-item ${step.done ? 'done' : ''}`}>
          <input type="checkbox" checked={step.done} onChange={(e) => toggle(step.key, e.target.checked)} style={{ width: 'auto' }} />
          <span className="ci-title">{step.label}</span>
        </div>
      ))}
    </Card>
  );
}

// The small panel members use to enter a code and join a chapter.
function JoinChapterPanel({ onJoined }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const join = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await api.joinChapterByCode(code.trim());
      toast.success(`Joined ${r.chapterName}!`);
      setCode('');
      onJoined();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <DashboardHero
        badge="Chapters"
        title="Join a chapter"
        subtitle="Chapters are private local communities. Enter the 8-character code your chapter leader gave you to join and start your onboarding."
      />
      <Card style={{ maxWidth: 480 }}>
        <form onSubmit={join}>
          <Field label="Join code">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. BAYAREA7"
              maxLength={8}
              autoCapitalize="characters"
              style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '0.2rem', fontSize: '1.1rem' }}
              required
            />
          </Field>
          <Button type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join chapter'}</Button>
        </form>
        <p className="muted" style={{ marginTop: '0.7rem', fontSize: '0.82rem' }}>
          Don't have a code? Ask your chapter leader — codes are shared privately.
        </p>
      </Card>
    </div>
  );
}

function MemberChapter({ ob }) {
  const [obState, setObState] = useState(ob);
  useEffect(() => { setObState(ob); }, [ob]);

  return (
    <div>
      <DashboardHero
        badge="My chapter"
        title={obState.chapterName}
        subtitle="Welcome to your chapter. Finish your onboarding checklist and keep an eye on chapter announcements in your feed."
      />
      <OnboardingChecklist ob={obState} onChange={setObState} />
      <Card style={{ marginTop: '1.1rem' }}>
        <div className="card-row">
          <h3 style={{ margin: 0 }}>Chapter feed</h3>
          <Link className="link-btn" to="/researcher/community">Open community →</Link>
        </div>
        <p className="muted" style={{ margin: '0.5rem 0 0' }}>
          Chapter announcements show up in your <Link to="/researcher">Home feed</Link> and as notifications.
        </p>
      </Card>
    </div>
  );
}

// --- page entry -------------------------------------------------------------

export default function ChapterHome() {
  const { user } = useAuth();
  const isLeader = (user?.tags || []).includes('chapter_leader');

  const [chapter, setChapter] = useState(null);     // leader's chapter (or null)
  const [ob, setOb] = useState(null);               // member onboarding (or null)
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // A leader reads their chapter dashboard; everyone also checks chapter
    // membership (onboarding) so a leader who is also a member still works, and
    // a plain member sees their chapter or the join panel.
    const [chap, onboarding] = await Promise.all([
      isLeader ? api.chapter().catch(() => null) : Promise.resolve(null),
      api.onboarding().catch(() => null),
    ]);
    setChapter(chap);
    setOb(onboarding);
    setLoading(false);
  }, [isLeader]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="page-loading">Loading…</div>;

  if (isLeader && chapter) return <LeaderDashboard chapter={chapter} reload={load} />;
  if (ob) return <MemberChapter ob={ob} />;

  // Chapter leader without a chapter record yet, or a member who hasn't joined.
  if (isLeader) {
    return (
      <div>
        <DashboardHero badge="Chapter Leader" title="Your chapter" subtitle="Run your local Synthica chapter." />
        <EmptyState>Your chapter isn't set up yet. Contact a platform admin to create your chapter, then your join code and roster will appear here.</EmptyState>
      </div>
    );
  }
  return <JoinChapterPanel onJoined={load} />;
}
