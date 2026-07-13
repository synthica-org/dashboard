import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../api.js';
import { useAuth, firstNameOf } from '../../../auth.jsx';
import { Card, Badge, EmptyState } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import StatCard from '../../../components/dashboard/StatCard.jsx';
import { imageSrc } from '../../../files.js';

// The baseline Member portal home. Every Synthica member is an Associate
// Researcher (ROLE_WORKFLOWS §4), so this is what a member sees first: a clear
// statement of what they can do, plus their live data — open listings to apply
// to, their applications, the projects they're on, news, and what's coming up.
//
// Role-specific homes (Lead, Chapter Leader, Independent) are owned by other
// units; this file only owns the member/associate experience rendered at the
// /researcher index.

const STATUS_TONE = { pending: 'gray', approved: 'green', rejected: 'red' };

// What an Associate Researcher can do on the platform — the "you are here" guide.
const GUIDE = [
  { icon: 'compass', label: 'Browse the Research Hub', desc: 'Open project listings posted by Lead Researchers.', to: '/researcher/hub' },
  { icon: 'microscope', label: 'Browse Research Groups', desc: 'Branded teams running related projects.', to: '/researcher/groups' },
  { icon: 'paperclip', label: 'Apply to projects & groups', desc: 'Your profile is sent automatically; some ask a few questions.', to: '/researcher/hub' },
  { icon: 'folder', label: 'See My Projects', desc: 'Everything you have joined, in one place.', to: '/researcher/projects' },
  { icon: 'megaphone', label: 'Join the community', desc: 'Feed, messages, and the people directory.', to: '/researcher/community' },
  { icon: 'calendar', label: 'Track your calendar', desc: 'Deadlines and events across your projects.', to: '/researcher/calendar' },
  { icon: 'folder-open', label: 'Open Synthica Drive', desc: 'Every file across your projects, in one browser.', to: '/researcher/drive' },
];

export default function AssociateHome() {
  const { user } = useAuth();
  const firstName = firstNameOf(user?.name);

  if (!user) return <div className="page-loading">Loading…</div>;

  return (
    <div>
      <DashboardHero firstName={firstName} />
      {/* Live status first — instructions are a dismissible follow-up, not the fold. */}
      <QuickStats />

      <div className="grid grid-2" style={{ alignItems: 'start', marginBottom: '2rem' }}>
        <OpenListings />
        <MyApplications />
      </div>

      <RoleGuide />

      <MemberProjects />

      <div className="grid grid-2" style={{ alignItems: 'start', marginBottom: '0.5rem' }}>
        <LatestNews />
        <UpcomingItems />
      </div>
    </div>
  );
}

// --- Hero --------------------------------------------------------------------
// A single, unmistakable banner: this is your Member portal and here's the gist.
function DashboardHero({ firstName }) {
  return (
    <section className="hero-card hero-card--member" style={{ marginBottom: '1.5rem' }}>
      <div style={{ minWidth: 0 }}>
        <div className="hero-eyebrow">
          <Icon name="compass" size={13} /> Member portal
        </div>
        <h1 className="page-title" style={{ margin: '0.35rem 0 0.4rem' }}>
          Welcome, {firstName}
        </h1>
        <p style={{ margin: 0, maxWidth: '52ch', lineHeight: 1.5 }}>
          Find projects, join a team, and connect with researchers. As an{' '}
          <strong>Associate Researcher</strong> you can browse the Research Hub, apply to projects and
          groups, and collaborate from My Projects.
        </p>
        <div className="hero-actions row">
          <Link to="/researcher/hub" className="btn btn-sm hero-btn">
            <Icon name="compass" size={15} /> Browse Research Hub
          </Link>
          <Link to="/researcher/groups" className="btn btn-sm hero-btn-ghost">
            Browse Groups
          </Link>
        </div>
      </div>
    </section>
  );
}

// --- Role guide --------------------------------------------------------------
// Plain-language list of what this role can do, each linking to the right page.
// Dismissible: once a member knows the ropes it shouldn't occupy the home page.
const GUIDE_DISMISS_KEY = 'synthica.guide.associate.dismissed';

function RoleGuide() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(GUIDE_DISMISS_KEY) === '1');
  if (dismissed) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 className="section-title">Getting started</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { localStorage.setItem(GUIDE_DISMISS_KEY, '1'); setDismissed(true); }}
        >
          Dismiss
        </button>
      </div>
      <div className="grid grid-3">
        {GUIDE.map((g) => (
          <Link key={g.label} to={g.to} style={{ color: 'inherit' }}>
            <Card className="paper-card" style={{ height: '100%' }}>
              <div className="row" style={{ gap: '0.55rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span className="guide-ico" aria-hidden="true"><Icon name={g.icon} size={20} /></span>
                <strong>{g.label}</strong>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{g.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

// --- At-a-glance counts ------------------------------------------------------
// Three numbers a member cares about: projects joined, live applications, open
// listings they could still apply to. Derived from the same data shown below.
function QuickStats() {
  const { user } = useAuth();
  const [projects, setProjects] = useState(null);
  const [apps, setApps] = useState(null);
  const [listings, setListings] = useState(null);

  useEffect(() => {
    api.myProjects().then(setProjects).catch(() => setProjects([]));
    api.myApplications().then(setApps).catch(() => setApps([]));
    api.listings().then(setListings).catch(() => setListings([]));
  }, []);

  if (!projects || !apps || !listings) return null;

  const pendingApps = apps.filter((a) => a.status === 'pending').length;
  const openListings = listings.filter((l) => l.leadId !== user.id).length;

  const stats = [
    { icon: 'folder', label: 'Projects joined', value: projects.length, to: '/researcher/projects' },
    { icon: 'mail', label: 'Applications pending', value: pendingApps, to: '/researcher/hub' },
    { icon: 'compass', label: 'Open listings', value: openListings, to: '/researcher/hub' },
  ];

  return (
    <div className="dash-stat-grid" style={{ marginBottom: '1.75rem' }}>
      {stats.map((s) => (
        <Link key={s.label} to={s.to} style={{ color: 'inherit' }}>
          <StatCard label={s.label} value={s.value} icon={s.icon} className="dash-stat-link" />
        </Link>
      ))}
    </div>
  );
}

// --- Open listings to apply to ----------------------------------------------
function OpenListings() {
  const { user } = useAuth();
  const [listings, setListings] = useState(null);
  useEffect(() => { api.listings().then(setListings).catch(() => setListings([])); }, []);

  const open = (listings || []).filter((l) => l.leadId !== user.id).slice(0, 4);

  return (
    <Card>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <div className="section-head" style={{ margin: 0 }}>
          <div className="section-badge"><Icon name="compass" size={12} /> Research Hub</div>
        </div>
        <Link to="/researcher/hub" className="muted" style={{ fontSize: '0.82rem' }}>Browse all →</Link>
      </div>
      {!listings ? (
        <p className="muted" style={{ margin: 0 }}>Loading…</p>
      ) : open.length === 0 ? (
        <EmptyState>No open listings right now — check back soon.</EmptyState>
      ) : (
        <div className="stack">
          {open.map((l) => {
            const spotsOpen = Math.max(0, (l.spots || 0) - Math.max(0, (l.filled || 1) - 1));
            return (
              <Link key={l.id} to="/researcher/hub" className="info-block" style={{ display: 'block', color: 'inherit' }}>
                <div className="card-row">
                  <strong style={{ minWidth: 0 }}>{l.title}</strong>
                  <Badge tone="gray">{l.category}</Badge>
                </div>
                {l.description && (
                  <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</p>
                )}
                <div className="muted" style={{ fontSize: '0.74rem', marginTop: '0.25rem' }}>
                  {l.leadName || 'A Lead Researcher'} · {spotsOpen} of {l.spots} spot{l.spots === 1 ? '' : 's'} open
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// --- My applications + status -----------------------------------------------
// Joins each application to its listing (the record only stores listingId) so we
// can show a human title and its accept/reject state.
function MyApplications() {
  const [apps, setApps] = useState(null);
  const [listings, setListings] = useState([]);

  useEffect(() => {
    api.myApplications().then(setApps).catch(() => setApps([]));
    api.listings().then(setListings).catch(() => {});
  }, []);

  const byId = useMemo(() => Object.fromEntries(listings.map((l) => [l.id, l])), [listings]);
  const projectApps = (apps || []).filter((a) => a.listingId);

  return (
    <Card>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <div className="section-head" style={{ margin: 0 }}>
          <div className="section-badge"><Icon name="mail" size={12} /> My applications</div>
        </div>
      </div>
      {!apps ? (
        <p className="muted" style={{ margin: 0 }}>Loading…</p>
      ) : projectApps.length === 0 ? (
        <EmptyState>You haven't applied to a project yet. <Link to="/researcher/hub">Find one in the Hub →</Link></EmptyState>
      ) : (
        <div className="stack">
          {projectApps.map((a) => {
            const listing = byId[a.listingId];
            return (
              <div key={a.id} className="info-block">
                <div className="card-row">
                  <strong style={{ minWidth: 0 }}>{listing?.title || 'Project listing'}</strong>
                  <Badge tone={STATUS_TONE[a.status] || 'gray'}>{a.status}</Badge>
                </div>
                <div className="muted" style={{ fontSize: '0.74rem', marginTop: '0.2rem' }}>
                  {listing?.category ? `${listing.category} · ` : ''}Applied {new Date(a.at).toLocaleDateString()}
                </div>
                {a.status === 'approved' && (
                  <Link to="/researcher/projects" className="label-up" style={{ marginTop: '0.3rem', display: 'inline-block' }}>
                    Go to My Projects →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// --- Projects the member is on ----------------------------------------------
function MemberProjects() {
  const [projects, setProjects] = useState(null);
  useEffect(() => { api.myProjects().then(setProjects).catch(() => setProjects([])); }, []);

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="section-title">Projects you're on</h2>
        <Link to="/researcher/projects" className="muted" style={{ fontSize: '0.82rem' }}>View all →</Link>
      </div>
      {!projects ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <EmptyState>You're not on any projects yet — <Link to="/researcher/hub">browse the Research Hub</Link> and apply to join a team.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {projects.slice(0, 6).map((p) => (
            <Link key={p.id} to={`/researcher/project/${p.id}`} style={{ color: 'inherit' }}>
              <Card className="paper-card">
                <Badge>{p.category}</Badge>
                <h3>{p.title}</h3>
                <p className="paper-meta">{(p.members?.length ?? 0)} members · {(p.tasks?.length ?? 0)} tasks</p>
                <span className="label-up">Open project →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// --- Latest news -------------------------------------------------------------
function LatestNews() {
  const [news, setNews] = useState(null);
  useEffect(() => { api.news().then(setNews).catch(() => setNews([])); }, []);
  const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <Card>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <div className="section-head" style={{ margin: 0 }}>
          <div className="section-badge"><Icon name="megaphone" size={12} /> Latest news</div>
        </div>
        <Link to="/researcher/news" className="muted" style={{ fontSize: '0.82rem' }}>View all →</Link>
      </div>
      {!news ? (
        <p className="muted" style={{ margin: 0 }}>Loading…</p>
      ) : news.length === 0 ? (
        <EmptyState>No announcements yet.</EmptyState>
      ) : (
        <div className="stack">
          {news.slice(0, 3).map((n) => (
            <div key={n.id} className="info-block" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
              {n.bannerUrl && <img src={imageSrc(n.bannerUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', flex: 'none' }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{n.title}</div>
                <div className="muted" style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>
                <div className="muted" style={{ fontSize: '0.72rem' }}>{n.authorName} · {fmt(n.at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Upcoming calendar items -------------------------------------------------
function UpcomingItems() {
  const [items, setItems] = useState(null);
  useEffect(() => { api.calendar().then(setItems).catch(() => setItems([])); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (items || []).filter((i) => i.date >= today).slice(0, 4);
  const icons = { paper: 'file-text', task: 'check-circle', event: 'calendar', workshop: 'calendar', meetup: 'calendar', pathway: 'compass' };
  const fmt = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  return (
    <Card>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <div className="section-head" style={{ margin: 0 }}>
          <div className="section-badge"><Icon name="calendar" size={12} /> Coming up</div>
        </div>
        <Link to="/researcher/calendar" className="muted" style={{ fontSize: '0.82rem' }}>Open calendar →</Link>
      </div>
      {!items ? (
        <p className="muted" style={{ margin: 0 }}>Loading…</p>
      ) : upcoming.length === 0 ? (
        <EmptyState>Nothing scheduled. Deadlines from your projects show up here.</EmptyState>
      ) : (
        <div className="stack">
          {upcoming.map((it) => (
            <div key={it.id} className="info-block" style={{ display: 'flex', gap: '0.7rem', alignItems: 'center' }}>
              <span className="guide-ico" aria-hidden="true"><Icon name={icons[it.kind] || 'calendar'} size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                <div className="muted" style={{ fontSize: '0.74rem' }}>{fmt(it.date)} · {it.context}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
