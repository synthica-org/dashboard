import { useEffect, useState, useCallback } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Card, Badge, Button, Field } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import { useAuth } from '../../auth.jsx';
import NewsPoster from '../../components/NewsPoster.jsx';
import Icon from '../../components/Icon.jsx';

// Admin control center, split into four sub-routes (Overview / People /
// Content / System). The section components below are unchanged — only the
// top-level shell and routing moved from a 13-section scroll page to tabs.

// The platform Admin account has full Director powers here.
function useIsDirector() {
  const { user } = useAuth();
  return user?.role === 'director' || user?.role === 'admin';
}

const TABS = [
  { to: '/editor/admin', label: 'Overview', end: true },
  { to: 'people', label: 'People' },
  { to: 'content', label: 'Content' },
  { to: 'system', label: 'System' },
];

// Legacy #adm-<section> deep links → the tab that now hosts that section.
const HASH_TAB = {
  analytics: '', people: 'people', applications: 'people', moderation: 'people',
  referrals: 'people', programs: 'content', competitions: 'content',
  events: 'content', archive: 'content', audit: 'system',
  integrations: 'system', backup: 'system', setup: 'system',
};

export default function AdminLayout() {
  const { hash } = useLocation();
  const navigate = useNavigate();

  // Hash-compat: old `/editor/admin#adm-people` links land on the right tab,
  // then scroll to the section once it has rendered.
  useEffect(() => {
    const m = /^#adm-(\w+)$/.exec(hash);
    if (!m || HASH_TAB[m[1]] === undefined) return undefined;
    const tab = HASH_TAB[m[1]];
    navigate({ pathname: `/editor/admin${tab ? `/${tab}` : ''}`, hash }, { replace: true });
    const t = setTimeout(() => document.getElementById(`adm-${m[1]}`)?.scrollIntoView(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — tab clicks don't remount this layout

  return (
    <div>
      <h1 className="page-title">Admin</h1>
      <p className="page-sub">Analytics, people, content, and system settings.</p>
      <nav className="admin-nav" aria-label="Admin sections">
        {TABS.map((t) => (
          <NavLink key={t.label} to={t.to} end={t.end}>{t.label}</NavLink>
        ))}
      </nav>
      <EmailStatusBanner />
      <Outlet />
    </div>
  );
}

export function AdminOverview() {
  const isDirector = useIsDirector();
  return (
    <>
      <section id="adm-analytics" className="admin-section"><AnalyticsCards /></section>
      {isDirector && <NewsPoster />}
    </>
  );
}

export function AdminPeople() {
  const isDirector = useIsDirector();
  return (
    <>
      <section id="adm-people" className="admin-section"><People isDirector={isDirector} /></section>
      <section id="adm-applications" className="admin-section"><Applications /></section>
      <section id="adm-moderation" className="admin-section"><Moderation /></section>
      <section id="adm-referrals" className="admin-section"><ReferralLeaderboard /></section>
    </>
  );
}

export function AdminContent() {
  const isDirector = useIsDirector();
  return (
    <>
      <section id="adm-programs" className="admin-section"><ProgramsPanel isDirector={isDirector} /></section>
      <section id="adm-competitions" className="admin-section"><CompetitionsAdmin /></section>
      <section id="adm-events" className="admin-section"><GlobalEvents /></section>
      <section id="adm-archive" className="admin-section"><Archive /></section>
    </>
  );
}

export function AdminSystem() {
  const isDirector = useIsDirector();
  return (
    <>
      <section id="adm-audit" className="admin-section"><AuditLog /></section>
      {isDirector && <section id="adm-integrations" className="admin-section"><Integrations /></section>}
      {isDirector && <section id="adm-backup" className="admin-section"><Backup /></section>}
      <section id="adm-setup" className="admin-section"><SetupGuide /></section>
    </>
  );
}

// Warns when no email provider is configured — verification + password-reset
// emails silently don't send in that state, which is easy to miss in prod.
function EmailStatusBanner() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api.config().then(setCfg).catch(() => {}); }, []);
  if (!cfg || cfg.emailConfigured !== false) return null;
  return (
    <div className="login-error alert-warning" style={{ marginBottom: '1rem' }}>
      {/* Single child span: icon-label is inline-flex, so loose text nodes would wrap as separate flex items. */}
      <span className="icon-label"><Icon name="alert" size={16} /> <span>Email delivery isn't configured (no <code>RESEND_API_KEY</code>). Password-reset and verification emails won't actually send. Set it in your backend env to enable them.</span></span>
    </div>
  );
}

const TAGS = ['lead_researcher', 'associate_researcher', 'chapter_leader', 'independent_researcher'];
// Human labels for the raw enum values — admins shouldn't read snake_case.
const TAG_LABELS = {
  lead_researcher: 'Lead Researcher',
  associate_researcher: 'Associate Researcher',
  chapter_leader: 'Chapter Leader',
  independent_researcher: 'Independent Researcher',
};
const EDITOR_ROLES = ['reviews', 'associate', 'senior', 'chief', 'director', 'auditor'];
const EDITOR_ROLE_LABELS = {
  reviews: 'Reviews Editor',
  associate: 'Associate Editor',
  senior: 'Senior Editor',
  chief: 'Editor-in-Chief',
  director: 'Director',
  auditor: 'Auditor',
};
const CATS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];
const ARTICLE_TYPES = ['Article', 'Letter', 'Analysis', 'Review', 'Preprint', 'Dataset', 'Conference Paper'];

// Parse hosted full text into sections; a line beginning "## " starts a section.
function parseFullText(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const out = [];
  let cur = { heading: '', body: '' };
  for (const line of t.split('\n')) {
    const m = line.match(/^##\s+(.*)/);
    if (m) {
      if (cur.heading || cur.body.trim()) out.push({ heading: cur.heading, body: cur.body.trim() });
      cur = { heading: m[1].trim(), body: '' };
    } else {
      cur.body += line + '\n';
    }
  }
  if (cur.heading || cur.body.trim()) out.push({ heading: cur.heading, body: cur.body.trim() });
  return out;
}

// People lookup + role management. Auditors review/re-assign researcher roles
// (with the same signals + suggestion shown at onboarding); directors also get
// editor-role and bulk powers.
function People({ isDirector }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const [bulk, setBulk] = useState({ emails: '', tag: 'lead_researcher' });
  const [visibleCount, setVisibleCount] = useState(3);

  const search = (query) => api.adminUsers(query).then(setUsers).catch(() => {});
  useEffect(() => { search(''); setVisibleCount(3); }, []);

  // Directors use the full role endpoint; auditors the tags-only one.
  const setTags = (u, body) => (isDirector ? api.adminSetRole(u.id, body) : api.adminSetTags(u.id, body));
  const addTag = (u, tag) =>
    setTags(u, { addTags: [tag] }).then(() => { toast.success(`${u.name} → ${TAG_LABELS[tag] || tag}`); search(q); }).catch((e) => toast.error(e.message));
  const removeTag = (u, tag) =>
    setTags(u, { removeTags: [tag] }).then(() => search(q)).catch((e) => toast.error(e.message));
  const makeEditor = (u, role, category) =>
    api.adminSetRole(u.id, { kind: 'editor', role, category: category || null }).then(() => { toast.success(`${u.name} → ${role} editor`); search(q); }).catch((e) => toast.error(e.message));

  const runBulk = () =>
    api.adminBulkRole(bulk).then((r) => toast.success(`Updated ${r.updated.length}${r.notFound.length ? `, ${r.notFound.length} not found` : ''}`)).then(() => search(q)).catch((e) => toast.error(e.message));

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>People</h2>

      {isDirector && (
        <Card style={{ marginBottom: '1rem' }}>
          <h3>Bulk assign by email</h3>
          <p className="muted" style={{ margin: '0.25rem 0 0.6rem' }}>Paste comma- or space-separated emails to grant a role to all of them.</p>
          <textarea placeholder="a@x.com, b@y.com, …" value={bulk.emails} onChange={(e) => setBulk({ ...bulk, emails: e.target.value })} />
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <select value={bulk.tag} onChange={(e) => setBulk({ ...bulk, tag: e.target.value })} style={{ width: 'auto' }}>
              {TAGS.map((t) => <option key={t} value={t}>{TAG_LABELS[t] || t}</option>)}
            </select>
            <Button onClick={runBulk}>Assign to all</Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="card-row">
          <h3>Lookup</h3>
          <input placeholder="Search name / email / username" value={q} onChange={(e) => { setQ(e.target.value); search(e.target.value); setVisibleCount(3); }} style={{ maxWidth: 280 }} />
        </div>
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          {users.slice(0, visibleCount).map((u) => (
            <div key={u.id} className="info-block">
              <div className="card-row">
                <div>
                  <strong>{u.name}</strong> <Badge tone="gray">{u.kind}{u.role ? ` · ${u.role}` : ''}{u.category ? ` · ${u.category}` : ''}</Badge>
                  {!u.approved && <> <Badge tone="gold">pending approval</Badge></>}
                  {u.suspended && <> <Badge tone="red">suspended</Badge></>}
                  <div className="muted" style={{ fontSize: '0.78rem' }}>{u.email}</div>
                  {u.kind === 'researcher' && (
                    <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>
                      Research {u.researchExperience ?? '—'}/10 · Leadership {u.leadershipExperience ?? '—'}/10
                      {u.wantsChapterLead ? ' · wants to lead a chapter' : ''}{u.gpa ? ` · GPA ${u.gpa}` : ''}
                      {u.resumeUrl && <> · <a href={u.resumeUrl} target="_blank" rel="noreferrer">résumé</a></>}
                      {u.experienceSummary && <div style={{ marginTop: '0.15rem', color: 'var(--slate)' }}>“{u.experienceSummary}”</div>}
                    </div>
                  )}
                  {u.recommendation && !(u.tags || []).includes(u.recommendation.tag) && (
                    <div style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
                      <Badge tone="gold">Suggested: {u.recommendation.label}</Badge>{' '}
                      <span className="muted">{u.recommendation.reason}</span>
                    </div>
                  )}
                  <div className="row" style={{ marginTop: '0.3rem' }}>
                    {(u.tags || []).map((t) => (
                      <button key={t} className="badge badge-blue" style={{ cursor: 'pointer', border: 'none' }} title="Click to remove" onClick={() => removeTag(u, t)}>{TAG_LABELS[t] || t} <Icon name="x" size={12} /></button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: '0.4rem' }}>
                <select defaultValue="" onChange={(e) => e.target.value && (addTag(u, e.target.value), (e.target.value = ''))} style={{ width: 'auto' }}>
                  <option value="">+ tag…</option>
                  {TAGS.map((t) => <option key={t} value={t}>{TAG_LABELS[t] || t}</option>)}
                </select>
                {u.recommendation && !(u.tags || []).includes(u.recommendation.tag) && (
                  <Button className="btn-sm" variant="ghost" onClick={() => addTag(u, u.recommendation.tag)}>Apply suggestion</Button>
                )}
                {isDirector && <EditorRolePicker onPick={(role, cat) => makeEditor(u, role, cat)} />}
                {isDirector && <MemberAdminActions u={u} onChanged={() => search(q)} />}
              </div>
            </div>
          ))}
          {users.length > visibleCount && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setVisibleCount((c) => Math.min(c + 5, users.length))}
              style={{ marginTop: '0.5rem', width: '100%' }}
            >
              Show more ({users.length - visibleCount} remaining)
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

function EditorRolePicker({ onPick }) {
  const [role, setRole] = useState('');
  const [cat, setCat] = useState('');
  return (
    <span className="row">
      <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>
        <option value="">make editor…</option>
        {EDITOR_ROLES.map((r) => <option key={r} value={r}>{EDITOR_ROLE_LABELS[r] || r}</option>)}
      </select>
      {['reviews', 'associate', 'senior'].includes(role) && (
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
          <option value="">category…</option>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
      )}
      {role && <Button className="btn-sm" onClick={() => onPick(role, cat)}>Apply</Button>}
    </span>
  );
}

// Append-only log of editorial + admin actions.
function AuditLog() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.adminAudit().then(setRows).catch(() => {}); }, []);
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Audit log</h2>
      <Card>
        <div className="stack">
          {rows.slice(0, 30).map((r) => (
            <div key={r.id} className="muted" style={{ fontSize: '0.82rem' }}>
              <strong>{new Date(r.at).toLocaleString()}</strong> · {r.actorName} · <Badge tone="gray">{r.action}</Badge> {r.detail}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Download a full JSON snapshot for backup (Director only).
function Backup() {
  const toast = useToast();
  const download = async () => {
    try {
      const data = await api.adminExport();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `synthica-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <div className="card-row">
        <div>
          <h3>Backup</h3>
          <p className="muted" style={{ marginTop: '0.2rem' }}>Download a full JSON snapshot of all data.</p>
        </div>
        <Button onClick={download}>Export backup</Button>
      </div>
    </Card>
  );
}

// In-app deployment / integration guide so the director can self-serve setup.
function SetupGuide() {
  const guides = [
    {
      t: 'Google Sign-In',
      steps: [
        'Google Cloud Console → APIs & Services → OAuth consent screen (External; add email/profile/openid scopes).',
        'Credentials → Create OAuth client ID → Web application. Authorized JS origins = your dashboards URL + http://localhost:5173.',
        'Copy the Client ID. Set GOOGLE_CLIENT_ID on the backend (Render) AND VITE_GOOGLE_CLIENT_ID on the dashboards (Vercel) — same value — then redeploy.',
        'A "Continue with Google" button then appears on Login & Register.',
      ],
    },
    {
      t: 'Discord webhook',
      steps: [
        'Discord → your channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL.',
        'Paste it in Integrations above and Save (or set DISCORD_WEBHOOK_URL on the backend to persist).',
        'Click "Send Discord test" to confirm. You\'ll get a message every time a paper moves up or is declined.',
      ],
    },
    {
      t: 'WhatsApp alerts',
      steps: [
        'WhatsApp has no plain webhook — use a relay. Create a Twilio / Make / Zapier webhook that forwards a JSON {text} payload to your WhatsApp number or group.',
        'Paste that relay URL in Integrations above (or set WHATSAPP_WEBHOOK_URL on the backend).',
      ],
    },
    {
      t: 'Author emails (Resend)',
      steps: [
        'Create an account at resend.com and an API key; verify your sending domain.',
        'Set RESEND_API_KEY and EMAIL_FROM on the backend. Authors are then emailed on accept/decline/revision automatically.',
        'Without a key, those emails are just logged (no-op).',
      ],
    },
    {
      t: 'Persistent data (Google Sheets)',
      steps: [
        'Create a Google service account + enable the Sheets API; share a spreadsheet with its client_email as Editor.',
        'Set DATA_PROVIDER=sheets, SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON on the backend.',
        'Run `npm run seed:sheet` once to create the tabs. Full steps in docs/GOOGLE_SHEETS.md.',
      ],
    },
    {
      t: 'Security before going public',
      steps: [
        'Set a long random AUTH_SECRET (signs login tokens).',
        'Lock CORS to your real frontend domains in backend/server.js.',
        'Use an always-on backend instance (no cold starts). Full list in DEPLOY.md.',
      ],
    },
  ];
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Setup & deployment guide</h2>
      <div className="stack">
        {guides.map((g) => (
          <Card key={g.t}>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{g.t}</summary>
              <ol style={{ margin: '0.6rem 0 0 1.1rem', color: 'var(--body)', lineHeight: 1.7 }}>
                {g.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </details>
          </Card>
        ))}
      </div>
      <p className="muted" style={{ marginTop: '0.75rem' }}>Full reference: <code>DEPLOY.md</code> and <code>docs/GOOGLE_SHEETS.md</code> in the repo.</p>
    </div>
  );
}

const STAGE_LABELS = {
  review: 'In review', senior_screen: 'Senior screen', associate: 'With associate',
  senior_final: 'Senior final', chief: 'With chief', published: 'Published', rejected: 'Declined',
};

// Horizontal bar chart (pure CSS) for a {label: count} map.
function Bars({ data, labels = {}, tone = 'blue' }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <p className="muted" style={{ margin: 0 }}>No data yet.</p>;
  const max = Math.max(...entries.map(([, n]) => n));
  return (
    <div className="bars">
      {entries.map(([k, n]) => (
        <div key={k} className="bar-row">
          <span className="bar-label">{labels[k] || k}</span>
          <span className="bar-track">
            <span className={`bar-fill bar-${tone}`} style={{ width: `${Math.max(6, (n / max) * 100)}%` }} />
          </span>
          <span className="bar-num">{n}</span>
        </div>
      ))}
    </div>
  );
}

function AnalyticsCards() {
  const [a, setA] = useState(null);
  const load = useCallback(() => { api.adminAnalytics().then(setA).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!a) return <Card><p className="muted" style={{ margin: 0 }}>Loading analytics…</p></Card>;
  const pipeline = a.pipelineSubmissions ?? a.submissions ?? 0;
  const pendingApps = a.pendingApplications ?? 0;
  const pendingPapers = a.pendingPapers ?? 0;
  const pendingTotal = a.pendingReviews ?? (pendingApps + pendingPapers);
  const kpis = [
    { icon: 'users', label: 'Members', value: a.users, sub: `${a.researchers} researchers · ${a.editors} editors` },
    { icon: 'file-text', label: 'Published papers', value: a.published, sub: `${pipeline} in editorial pipeline` },
    { icon: 'flask', label: 'Active projects', value: a.projects, sub: `${a.chapters} chapters worldwide` },
    { icon: 'eye', label: 'Article reads', value: (a.totalAccesses || 0).toLocaleString(), sub: 'all-time accesses' },
    { icon: 'id-card', label: 'Pending reviews', value: pendingTotal, sub: `${pendingApps} applications · ${pendingPapers} papers`, hot: pendingTotal > 0 },
  ];
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Analytics</h2>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi ${k.hot ? 'kpi-hot' : ''}`}>
            <span className="kpi-icon"><Icon name={k.icon} size={22} /></span>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        <Card>
          <h3 style={{ marginTop: 0 }}>Pipeline by stage</h3>
          <Bars data={a.byStage} labels={STAGE_LABELS} tone="blue" />
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>Published by subject</h3>
          <Bars data={a.byCategory} tone="gold" />
        </Card>
      </div>
    </div>
  );
}

function Integrations() {
  const toast = useToast();
  const [form, setForm] = useState({ discordWebhookUrl: '', whatsappWebhookUrl: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSettings().then((s) => setForm({ discordWebhookUrl: s.discordWebhookUrl || '', whatsappWebhookUrl: s.whatsappWebhookUrl || '' })).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true); setError('');
    try { await api.setSettings(form); toast.success('Integrations saved'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError('');
    try { await api.setSettings(form); await api.testWebhook(); toast.success('Test sent to Discord'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <h3>Integrations</h3>
      <p className="muted" style={{ margin: '0.25rem 0 0.75rem' }}>Notification channels for the editorial queue.</p>
      {error && <div className="login-error">{error}</div>}
      <Field label="Discord webhook URL"><input value={form.discordWebhookUrl} onChange={(e) => setForm({ ...form, discordWebhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/…" /></Field>
      <Field label="WhatsApp relay webhook URL (Twilio/Make/Zapier)"><input value={form.whatsappWebhookUrl} onChange={(e) => setForm({ ...form, whatsappWebhookUrl: e.target.value })} placeholder="https://…" /></Field>
      <div className="row">
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" onClick={test} disabled={busy}>Send Discord test</Button>
      </div>
      <p className="muted" style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}>
        Set <code>DISCORD_WEBHOOK_URL</code> / <code>WHATSAPP_WEBHOOK_URL</code> on the backend to persist across restarts.
      </p>
    </Card>
  );
}

// Paper archive: upload past/external papers (arXiv/Nature-style), verify
// self-archived submissions, and manage the published record.
function Archive() {
  const toast = useToast();
  const [pubs, setPubs] = useState([]);
  const [queue, setQueue] = useState([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    api.adminPublications().then(setPubs).catch(() => {});
    api.adminArchiveQueue().then(setQueue).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const verify = (id, status) =>
    api.verifyPublication(id, status).then(() => { toast.success(`Paper ${status}`); load(); }).catch((e) => toast.error(e.message));
  const remove = (id) => {
    if (!window.confirm('Remove this paper from the archive?')) return;
    api.adminDeletePublication(id).then(() => { toast.success('Removed'); load(); }).catch((e) => toast.error(e.message));
  };

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Paper archive <Badge tone="gray">{pubs.length}</Badge></h2>
        <Button onClick={() => setOpen((o) => !o)}>{open ? 'Close' : '+ Upload paper'}</Button>
      </div>
      <p className="muted" style={{ margin: '0 0 0.6rem' }}>Upload past or external papers, verify member self-archives, and curate the public archive.</p>

      {open && <UploadForm onDone={() => { setOpen(false); load(); }} />}

      {queue.length > 0 && (
        <>
          <h3 style={{ margin: '1rem 0 0.4rem' }}>Pending verification <Badge tone="gold">{queue.length}</Badge></h3>
          <div className="stack">
            {queue.map((p) => (
              <Card key={p.id}>
                <div className="card-row">
                  <div>
                    <strong>{p.title}</strong>
                    <div className="muted" style={{ fontSize: '0.8rem' }}>{p.authors.map((a) => a.name).join(', ')} · {p.category} · {p.publishedAt}</div>
                    {p.pdfUrl && <a href={p.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem' }}>PDF / source</a>}
                  </div>
                  <div className="row">
                    <Button variant="approve" className="btn-sm" onClick={() => verify(p.id, 'approved')}>Verify</Button>
                    <Button variant="reject" className="btn-sm" onClick={() => verify(p.id, 'rejected')}>Reject</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <h3 style={{ margin: '1rem 0 0.4rem' }}>All papers</h3>
      {pubs.length === 0 ? (
        <Card><p className="muted">No papers in the archive yet.</p></Card>
      ) : (
        <div className="stack">
          {pubs.slice(0, 40).map((p) => <AdminPubRow key={p.id} p={p} onChanged={load} onRemove={remove} />)}
        </div>
      )}
    </div>
  );
}

// One archive row with feature/edit/delete controls.
function AdminPubRow({ p, onChanged, onRemove }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    title: p.title, category: p.category, articleType: p.articleType || 'Article',
    abstract: p.abstract || '', doi: p.doi || '', pdfUrl: p.pdfUrl || '', sourceUrl: p.sourceUrl || '',
    publishedAt: (p.publishedAt || '').slice(0, 10), keywords: (p.keywords || []).join(', '),
    volume: p.volume || '', issue: p.issue || '', pages: p.pages || '',
  });
  const [busy, setBusy] = useState(false);

  const feature = () =>
    api.featurePublication(p.id, !p.featured).then(() => { toast.success(p.featured ? 'Unfeatured' : 'Featured at the top of the archive'); onChanged(); }).catch((e) => toast.error(e.message));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await api.adminEditPublication(p.id, f); toast.success('Paper updated'); setEditing(false); onChanged(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <div className="card-row">
        <div style={{ minWidth: 0 }}>
          <strong>{p.title}</strong>{' '}
          {p.featured && <Badge tone="gold"><span className="icon-label"><Icon name="star" size={12} /> featured</span></Badge>}{' '}
          {p.verified === false && <Badge tone="gold">unverified</Badge>} <Badge tone="gray">{p.source || 'editorial'}</Badge>
          <div className="muted" style={{ fontSize: '0.8rem' }}>{(p.authors || []).map((a) => a.name).join(', ')} · {p.category} · {p.doi}</div>
        </div>
        <div className="row" style={{ flexShrink: 0 }}>
          <Button className="btn-sm" variant={p.featured ? 'primary' : 'ghost'} onClick={feature}>{p.featured ? <span className="icon-label"><Icon name="star" size={14} /> Unfeature</span> : <span className="icon-label"><Icon name="star-outline" size={14} /> Feature</span>}</Button>
          <Button className="btn-sm" variant="ghost" onClick={() => setEditing((x) => !x)}>{editing ? 'Cancel' : 'Edit'}</Button>
          <Button variant="reject" className="btn-sm" onClick={() => onRemove(p.id)}>Delete</Button>
        </div>
      </div>
      {editing && (
        <form onSubmit={save} style={{ marginTop: '0.7rem', borderTop: '1px solid var(--border)', paddingTop: '0.7rem' }}>
          <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <div className="grid grid-3">
            <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Type"><select value={f.articleType} onChange={(e) => setF({ ...f, articleType: e.target.value })}>{ARTICLE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Published"><input type="date" value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} /></Field>
          </div>
          <Field label="Abstract"><textarea rows={3} value={f.abstract} onChange={(e) => setF({ ...f, abstract: e.target.value })} /></Field>
          <div className="grid grid-2">
            <Field label="DOI"><input value={f.doi} onChange={(e) => setF({ ...f, doi: e.target.value })} /></Field>
            <Field label="Keywords (comma-separated)"><input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} /></Field>
          </div>
          <div className="grid grid-2">
            <Field label="PDF link"><input value={f.pdfUrl} onChange={(e) => setF({ ...f, pdfUrl: e.target.value })} /></Field>
            <Field label="Source URL"><input value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} /></Field>
          </div>
          <div className="grid grid-3">
            <Field label="Volume"><input value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} /></Field>
            <Field label="Issue"><input value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} /></Field>
            <Field label="Pages"><input value={f.pages} onChange={(e) => setF({ ...f, pages: e.target.value })} /></Field>
          </div>
          <Button type="submit" className="btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </form>
      )}
    </Card>
  );
}

// arXiv-style upload form — metadata + PDF link, with authors linkable to profiles.
function UploadForm({ onDone }) {
  const toast = useToast();
  const [profiles, setProfiles] = useState([]);
  useEffect(() => { api.profiles().then(setProfiles).catch(() => {}); }, []);
  const [f, setF] = useState({
    title: '', category: CATS[0], articleType: 'Article', abstract: '', doi: '',
    pdfUrl: '', sourceUrl: '', publishedAt: '', keywords: '', volume: '', issue: '', pages: '', fullText: '', references: '',
  });
  const [authors, setAuthors] = useState([{ name: '', affiliation: '', userId: '' }]);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setA = (i, patch) => setAuthors((xs) => xs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const linkProfile = (i, id) => {
    const p = profiles.find((x) => x.id === id);
    setA(i, { userId: id, ...(p ? { name: p.name, affiliation: p.institution || '' } : {}) });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Host full text: each "## Heading" line starts a new section.
      const sections = parseFullText(f.fullText);
      await api.adminAddPublication({
        ...f,
        sections,
        references: f.references,
        authors: authors.filter((a) => a.name.trim()).map((a) => ({ name: a.name, affiliation: a.affiliation, userId: a.userId || null })),
      });
      toast.success('Paper added to the archive');
      onDone();
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };

  return (
    <Card style={{ marginBottom: '0.6rem' }}>
      <form onSubmit={submit}>
        <Field label="Title"><input value={f.title} onChange={(e) => set({ title: e.target.value })} required /></Field>
        <div className="grid grid-2">
          <Field label="Category"><select value={f.category} onChange={(e) => set({ category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Type"><select value={f.articleType} onChange={(e) => set({ articleType: e.target.value })}>{ARTICLE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>

        <label className="label-up" style={{ display: 'block', margin: '0.4rem 0 0.2rem' }}>Authors</label>
        <div className="stack">
          {authors.map((a, i) => (
            <div key={i} className="row" style={{ gap: '0.4rem' }}>
              <input placeholder="Full name" value={a.name} onChange={(e) => setA(i, { name: e.target.value })} style={{ flex: 2 }} />
              <input placeholder="Affiliation" value={a.affiliation} onChange={(e) => setA(i, { affiliation: e.target.value })} style={{ flex: 2 }} />
              <select value={a.userId} onChange={(e) => linkProfile(i, e.target.value)} style={{ flex: 1, width: 'auto' }} title="Link to a Synthica profile">
                <option value="">link profile…</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {authors.length > 1 && <button type="button" className="link-btn" onClick={() => setAuthors((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={14} /></button>}
            </div>
          ))}
        </div>
        <button type="button" className="link-btn" style={{ margin: '0.3rem 0 0.6rem' }} onClick={() => setAuthors((xs) => [...xs, { name: '', affiliation: '', userId: '' }])}>+ Add author</button>

        <Field label="Abstract"><textarea value={f.abstract} onChange={(e) => set({ abstract: e.target.value })} rows={3} /></Field>
        <div className="grid grid-2">
          <Field label="DOI or arXiv id (optional — auto-assigned if blank)"><input value={f.doi} onChange={(e) => set({ doi: e.target.value })} placeholder="10.xxxx/… or arXiv:2401.12345" /></Field>
          <Field label="Published date"><input type="date" value={f.publishedAt} onChange={(e) => set({ publishedAt: e.target.value })} /></Field>
        </div>
        <div className="grid grid-2">
          <Field label="PDF link"><input value={f.pdfUrl} onChange={(e) => set({ pdfUrl: e.target.value })} placeholder="https://…/paper.pdf" /></Field>
          <Field label="Source / external URL"><input value={f.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://arxiv.org/abs/…" /></Field>
        </div>
        <Field label="Keywords (comma-separated)"><input value={f.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="ecology, microplastics" /></Field>
        <Field label="Full text (optional — start a section with “## Heading”)">
          <textarea value={f.fullText} onChange={(e) => set({ fullText: e.target.value })} rows={6} placeholder={'## Introduction\nText…\n\n## Methods\nText…'} />
        </Field>
        <Field label="References (one per line)">
          <textarea value={f.references} onChange={(e) => set({ references: e.target.value })} rows={4} placeholder={'Smith, J. (2023). Title. Journal, 1(2), 3–4.'} />
        </Field>
        <div className="grid grid-3">
          <Field label="Volume"><input value={f.volume} onChange={(e) => set({ volume: e.target.value })} /></Field>
          <Field label="Issue"><input value={f.issue} onChange={(e) => set({ issue: e.target.value })} /></Field>
          <Field label="Pages"><input value={f.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="1–14" /></Field>
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add to archive'}</Button>
      </form>
    </Card>
  );
}

// Auditor queue: new-member onboarding (assign a role) + role/project applications.
function Applications() {
  const toast = useToast();
  const [apps, setApps] = useState([]);
  const load = useCallback(() => { api.adminApplications().then(setApps).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  // `extra` carries an optional rejection feedback note (used by project proposals).
  const review = (id, status, assignTag, extra) =>
    api.reviewApplication(id, status, assignTag, extra).then(() => { load(); toast.success(`Application ${status}`); }).catch((e) => toast.error(e.message));

  const onboarding = apps.filter((a) => a.kind === 'onboarding' && a.status === 'pending');
  const pendingOnboardingCount = onboarding.length;
  // Program applications have their own panel below (cohort admission).
  const others = apps.filter((a) => a.kind !== 'onboarding' && a.kind !== 'program' && a.status === 'pending');
  const pendingOthersCount = others.length;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>
        Onboarding <Badge tone="gray">{pendingOnboardingCount} pending</Badge>
      </h2>
      <p className="muted" style={{ margin: '0 0 0.6rem' }}>New members — approve and assign a starting role.</p>
      {pendingOnboardingCount === 0 ? (
        <Card><p className="muted">0 pending</p></Card>
      ) : (
        <div className="stack">{onboarding.map((a) => <AppRow key={a.id} a={a} review={review} assignable />)}</div>
      )}

      <h2 className="section-title" style={{ margin: '1.5rem 0 0.6rem' }}>
        Role &amp; project applications <Badge tone="gray">{pendingOthersCount} pending</Badge>
      </h2>
      {pendingOthersCount === 0 ? (
        <Card><p className="muted">0 pending</p></Card>
      ) : (
        <div className="stack">{others.map((a) => <AppRow key={a.id} a={a} review={review} assignable={!a.role && a.kind !== 'proposal'} />)}</div>
      )}
    </div>
  );
}

// A single application with approve/reject and (when assignable) a role picker.
// Onboarding rows default the picker to the system's recommended role.
function AppRow({ a, review, assignable }) {
  const [tag, setTag] = useState(a.recommendation?.tag || 'independent_researcher');
  const isProposal = a.kind === 'proposal';
  // Project proposals get rejected with feedback so the member can revise (§6.2).
  const reject = () => {
    if (!isProposal) return review(a.id, 'rejected');
    const note = window.prompt('Feedback for the researcher (what to revise):', '');
    if (note === null) return; // cancelled
    review(a.id, 'rejected', undefined, note);
  };
  return (
    <Card>
      <div className="card-row">
        <div>
          <strong>{a.userName}</strong> — {a.role || (isProposal ? 'project proposal' : a.kind === 'onboarding' ? 'new member' : 'project application')}
          {isProposal && a.category && <> · <Badge tone="gray">{a.category}</Badge></>}
          {a.assignedTag && <> · <Badge tone="green">{a.assignedTag}</Badge></>}
          {a.resumeUrl ? <> · <a href={a.resumeUrl} target="_blank" rel="noreferrer">résumé</a></> : (a.kind === 'onboarding' && <> · <span className="muted" style={{ fontSize: '0.8rem' }}>no résumé</span></>)}
          {a.kind === 'onboarding' && (
            <div className="info-block" style={{ marginTop: '0.4rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                Research {a.researchExperience ?? '—'}/10 · Leadership {a.leadershipExperience ?? '—'}/10
                {a.wantsChapterLead ? ' · wants to lead a chapter' : ''}{a.gpa ? ` · GPA ${a.gpa}` : ''}
              </div>
              {a.experienceSummary && (
                <div style={{ fontSize: '0.82rem', marginTop: '0.3rem', color: 'var(--slate)' }}>
                  “{a.experienceSummary}”
                </div>
              )}
              {a.priorLead && a.legacyProject?.title && (
                <div style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                  <Badge tone="gold">Returning lead</Badge>{' '}
                  <span className="muted">Claims project “{a.legacyProject.title}” ({a.legacyProject.category || 'no subject'}) — approving as Lead restores it.</span>
                </div>
              )}
              {a.recommendation && (
                <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
                  <Badge tone="gold">Suggested: {a.recommendation.label}</Badge>{' '}
                  <span className="muted">{a.recommendation.reason}</span>
                </div>
              )}
            </div>
          )}
          {isProposal && (
            <div className="info-block" style={{ marginTop: '0.4rem' }}>
              <div style={{ fontWeight: 700 }}>{a.title}</div>
              {a.description && <div style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{a.description}</div>}
              {a.methodology && <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}><strong>Methodology:</strong> {a.methodology}</div>}
            </div>
          )}
          {a.answers && (
            <details style={{ marginTop: '0.3rem' }}>
              <summary className="muted" style={{ cursor: 'pointer' }}>View application</summary>
              <div className="stack" style={{ marginTop: '0.3rem' }}>
                {Object.entries(a.answers).map(([k, v]) => v && (
                  <div key={k} className="muted" style={{ fontSize: '0.8rem' }}><strong>{k}:</strong> {v}</div>
                ))}
              </div>
            </details>
          )}
          {a.message && !a.answers && <div className="muted" style={{ marginTop: '0.2rem' }}>{a.message}</div>}
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>{new Date(a.at).toLocaleDateString()}</div>
        </div>
        <div className="row">
          {a.status === 'pending' ? (
            <>
              {assignable && (
                <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} title="Role to grant on approval">
                  {TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <Button variant="approve" className="btn-sm" onClick={() => review(a.id, 'approved', assignable ? tag : undefined)}>Approve</Button>
              <Button variant="reject" className="btn-sm" onClick={reject}>Reject</Button>
            </>
          ) : (
            <Badge tone={a.status === 'approved' ? 'green' : 'red'}>{a.status}</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

// Programs: cohort admissions for auditors; create/close/milestones + the
// weekly digest trigger for directors.
function ProgramsPanel({ isDirector }) {
  const toast = useToast();
  const [programs, setPrograms] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', cohortLabel: '', description: '', spots: 25, applyDeadline: '', startAt: '', endAt: '' });
  const load = useCallback(() => { api.adminPrograms().then(setPrograms).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const reviewApp = (id, status) =>
    api.reviewProgramApplication(id, status).then(() => { load(); toast.success(`Application ${status}`); }).catch((e) => toast.error(e.message));
  const toggleMs = (pid, mid, done) =>
    api.toggleProgramMilestone(pid, mid, done).then(load).catch((e) => toast.error(e.message));
  const setStatus = (pid, status) =>
    api.setProgramStatus(pid, status).then(() => { load(); toast.success(`Program ${status}`); }).catch((e) => toast.error(e.message));
  const create = (e) => {
    e.preventDefault();
    api.createProgram(form).then(() => { setShowCreate(false); setForm({ title: '', cohortLabel: '', description: '', spots: 25, applyDeadline: '', startAt: '', endAt: '' }); load(); toast.success('Program created'); }).catch((err) => toast.error(err.message));
  };
  const sendDigest = () =>
    api.sendDigest().then((r) => toast.success(`Digest sent to ${r.sent}/${r.recipients} researchers`)).catch((e) => toast.error(e.message));

  const pending = programs.flatMap((p) => p.applications.filter((a) => a.status === 'pending').map((a) => ({ ...a, programTitle: p.title })));

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="card-row" style={{ marginBottom: '0.6rem' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Programs <Badge tone="gray">{pending.length} pending</Badge></h2>
        {isDirector && (
          <div className="row">
            <Button variant="ghost" onClick={sendDigest}>Send weekly digest now</Button>
            <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ New program'}</Button>
          </div>
        )}
      </div>

      {showCreate && (
        <Card>
          <form onSubmit={create}>
            <div className="grid grid-2">
              <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
              <Field label="Cohort label (e.g. Summer 2026)"><input value={form.cohortLabel} onChange={(e) => setForm({ ...form, cohortLabel: e.target.value })} /></Field>
            </div>
            <Field label="Description"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-2">
              <Field label="Spots"><input type="number" min="0" value={form.spots} onChange={(e) => setForm({ ...form, spots: e.target.value })} /></Field>
              <Field label="Apply deadline"><input type="date" value={form.applyDeadline} onChange={(e) => setForm({ ...form, applyDeadline: e.target.value })} /></Field>
            </div>
            <div className="grid grid-2">
              <Field label="Starts"><input type="date" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} /></Field>
              <Field label="Ends"><input type="date" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} /></Field>
            </div>
            <Button type="submit">Create program</Button>
          </form>
        </Card>
      )}

      {pending.length > 0 && (
        <div className="stack" style={{ marginBottom: '0.8rem' }}>
          {pending.map((a) => (
            <Card key={a.id}>
              <div className="card-row">
                <div><strong>{a.userName}</strong> → {a.programTitle}{a.message && <div className="muted" style={{ fontSize: '0.82rem' }}>{a.message}</div>}</div>
                <div className="row">
                  <Button onClick={() => reviewApp(a.id, 'accepted')}>Accept</Button>
                  <Button variant="ghost" onClick={() => reviewApp(a.id, 'rejected')}>Reject</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="stack">
        {programs.map((p) => (
          <Card key={p.id}>
            <div className="card-row">
              <div>
                <strong>{p.title}</strong> {p.cohortLabel && <Badge>{p.cohortLabel}</Badge>} <Badge tone={p.status === 'open' ? 'green' : 'gray'}>{p.status}</Badge>
                <div className="muted" style={{ fontSize: '0.82rem' }}>
                  {p.cohortMembers.length}{p.spots ? `/${p.spots}` : ''} members
                  {p.cohortMembers.length > 0 && <> — {p.cohortMembers.map((m) => m.name).join(', ')}</>}
                </div>
              </div>
              {isDirector && (
                <div className="row">
                  {p.status === 'open'
                    ? <Button variant="ghost" onClick={() => setStatus(p.id, 'closed')}>Close</Button>
                    : <Button variant="ghost" onClick={() => setStatus(p.id, 'open')}>Reopen</Button>}
                </div>
              )}
            </div>
            {p.milestones.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                {p.milestones.map((m) => (
                  <label key={m.id} className="muted" style={{ fontSize: '0.84rem', cursor: isDirector ? 'pointer' : 'default' }}>
                    <input type="checkbox" checked={m.done} disabled={!isDirector} onChange={(e) => toggleMs(p.id, m.id, e.target.checked)} /> {m.title}
                  </label>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// Post competitions to the members' Competitions board.
function CompetitionsAdmin() {
  const toast = useToast();
  const [comps, setComps] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', url: '', category: '', deadline: '', prize: '' });
  const load = useCallback(() => { api.competitions().then(setComps).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const post = (e) => {
    e.preventDefault();
    api.addCompetition(form).then(() => { setForm({ title: '', description: '', url: '', category: '', deadline: '', prize: '' }); load(); toast.success('Competition posted'); }).catch((er) => toast.error(er.message));
  };
  const remove = (id) => api.deleteCompetition(id).then(() => { load(); toast.success('Removed'); }).catch((er) => toast.error(er.message));
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Competitions <Badge tone="gray">{comps.length}</Badge></h2>
      <Card style={{ marginBottom: '0.8rem' }}>
        <form onSubmit={post}>
          <div className="grid grid-2">
            <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
            <Field label="Link"><input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
          </div>
          <Field label="Description"><textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-3">
            <Field label="Category"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="">—</option>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Deadline"><input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
            <Field label="Prize"><input value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} placeholder="e.g. $5,000" /></Field>
          </div>
          <Button type="submit">Post competition</Button>
        </form>
      </Card>
      <div className="stack">
        {comps.map((c) => (
          <Card key={c.id}><div className="card-row"><div><strong>{c.title}</strong> {c.deadline && <Badge tone="gray">{c.deadline}</Badge>}</div><Button className="btn-sm" variant="reject" onClick={() => window.confirm(`Delete competition “${c.title}”?`) && remove(c.id)}>Delete</Button></div></Card>
        ))}
      </div>
    </div>
  );
}

// Post a platform-wide event (workshop, meetup) that shows on everyone's calendar.
function GlobalEvents() {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', type: 'workshop', dueAt: '' });
  const post = (e) => {
    e.preventDefault();
    api.addEvent({ title: form.title, type: form.type, dueAt: form.dueAt }).then(() => { setForm({ title: '', type: 'workshop', dueAt: '' }); toast.success('Event posted to all calendars'); }).catch((er) => toast.error(er.message));
  };
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Global events</h2>
      <Card>
        <p className="muted" style={{ marginTop: 0 }}>Workshops and platform-wide events appear on every member's Calendar.</p>
        <form onSubmit={post} className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></Field>
          <Field label="Type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="workshop">workshop</option><option value="meetup">meetup</option><option value="event">event</option></select></Field>
          <Field label="Date"><input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} required /></Field>
          <Button type="submit">Post</Button>
        </form>
      </Card>
    </div>
  );
}

// Who's referred the most members (for future rewards).
function ReferralLeaderboard() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.referralLeaderboard().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return null;
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Referral leaderboard</h2>
      <Card>
        {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>No referrals yet.</p> : (
          <div className="stack">
            {rows.map((r, i) => (
              <div key={r.id} className="card-row info-block">
                <div><strong>#{i + 1}</strong> {r.name}</div>
                <Badge tone="green">{r.count} referred</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// Director-only: suspend/reactivate a member + send them a password-reset email.
function MemberAdminActions({ u, onChanged }) {
  const toast = useToast();
  const suspend = () => {
    if (!u.suspended && !window.confirm(`Suspend ${u.name}? They lose access until reactivated.`)) return;
    api.adminSuspend(u.id, !u.suspended).then(() => { toast.success(u.suspended ? 'Reactivated' : 'Suspended'); onChanged(); }).catch((e) => toast.error(e.message));
  };
  const sendReset = () =>
    api.adminSendReset(u.id).then(() => toast.success('Password-reset email sent')).catch((e) => toast.error(e.message));
  return (
    <>
      <Button className="btn-sm" variant={u.suspended ? 'ghost' : 'reject'} onClick={suspend}>{u.suspended ? 'Reactivate' : 'Suspend'}</Button>
      <Button className="btn-sm" variant="ghost" onClick={sendReset}>Send reset</Button>
    </>
  );
}

// Director-only: branded email broadcast to a member segment.
function BroadcastEmail() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [f, setF] = useState({ subject: '', heading: '', body: '', audience: 'all' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.config().then(setCfg).catch(() => {}); }, []);
  const send = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Send this email to ${f.audience === 'all' ? 'all members' : f.audience}?`)) return;
    setBusy(true);
    try {
      const r = await api.adminBroadcast(f);
      toast.success(`Broadcast sent to ${r.sent} ${r.audience}`);
      setF({ subject: '', heading: '', body: '', audience: 'all' });
    } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Email broadcast</h2>
      <Card>
        {cfg && cfg.emailConfigured === false && (
          <p className="muted alert-warning" style={{ marginTop: 0 }}><span className="icon-label"><Icon name="alert" size={16} /> Email delivery isn't configured — broadcasts will be logged only.</span></p>
        )}
        <form onSubmit={send}>
          <div className="grid grid-2">
            <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required /></Field>
            <Field label="Audience">
              <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
                <option value="all">All members</option>
                <option value="researchers">Researchers</option>
                <option value="editors">Editors / staff</option>
              </select>
            </Field>
          </div>
          <Field label="Heading (optional — defaults to subject)"><input value={f.heading} onChange={(e) => setF({ ...f, heading: e.target.value })} /></Field>
          <Field label="Message (blank line = new paragraph)"><textarea rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required placeholder="Hey everyone, we just launched…" /></Field>
          <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send broadcast'}</Button>
          <span className="muted" style={{ marginLeft: '0.6rem', fontSize: '0.8rem' }}>Sent as a branded HTML email from your account.</span>
        </form>
      </Card>
    </div>
  );
}
// The reports queue: content members have flagged, with one-click resolution.
function ReportsQueue() {
  const toast = useToast();
  const [reports, setReports] = useState(null);
  useEffect(() => { api.adminReports('open').then(setReports).catch(() => setReports([])); }, []);

  const resolve = (id, action) => {
    const verb = action === 'dismiss' ? 'Dismiss this report' : action === 'remove' ? 'Remove the reported content' : 'Suspend the author (and remove the content)';
    if (action !== 'dismiss' && !window.confirm(`${verb}?`)) return;
    api.resolveReport(id, action).then(setReports).then(() => toast.success('Report resolved')).catch((e) => toast.error(e.message));
  };

  if (!reports) return null;
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>
        Reports queue {reports.length > 0 && <Badge tone="gold">{reports.length} open</Badge>}
      </h2>
      {reports.length === 0 ? (
        <Card><p className="muted" style={{ margin: 0 }}>No open reports — nothing to review. <span className="icon-label"><Icon name="party" size={16} /></span></p></Card>
      ) : (
        <div className="stack">
          {reports.map((r) => (
            <Card key={r.id}>
              <div className="card-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <Badge tone="red">{r.kind}</Badge>{' '}
                  <strong>{r.targetOwnerName}</strong>
                  <span className="muted" style={{ fontSize: '0.78rem' }}> · reported by {r.reporterName} · {new Date(r.at).toLocaleDateString()}</span>
                  {r.reason && <div style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>Reason: “{r.reason}”</div>}
                  {r.snippet && <div className="info-block" style={{ fontSize: '0.82rem', marginTop: '0.35rem' }}>{r.snippet}</div>}
                </div>
                <div className="row" style={{ flexShrink: 0, gap: '0.3rem' }}>
                  <Button className="btn-sm" variant="ghost" onClick={() => resolve(r.id, 'dismiss')}>Dismiss</Button>
                  <Button className="btn-sm" variant="reject" onClick={() => resolve(r.id, 'remove')}>Remove</Button>
                  <Button className="btn-sm" variant="reject" onClick={() => resolve(r.id, 'suspend')}>Suspend</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Moderation() {
  const toast = useToast();
  const [posts, setPosts] = useState([]);
  const load = useCallback(() => { api.posts().then(setPosts).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const remove = (id) => {
    if (!window.confirm('Delete this member post? This can\'t be undone.')) return;
    api.deletePost(id).then(() => { load(); toast.success('Post removed'); }).catch((e) => toast.error(e.message));
  };
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <ReportsQueue />
      <h2 className="section-title" style={{ marginBottom: '0.6rem' }}>Recent posts <Badge tone="gray">{posts.length}</Badge></h2>
      {posts.length === 0 ? (
        <Card><p className="muted" style={{ margin: 0 }}>No community posts yet.</p></Card>
      ) : (
        <div className="stack">
          {posts.slice(0, 12).map((p) => (
            <Card key={p.id}>
              <div className="card-row">
                <div>
                  <strong>{p.author?.name}</strong> <span className="muted" style={{ fontSize: '0.78rem' }}>· {new Date(p.at).toLocaleDateString()} · {p.likeCount} {p.likeCount === 1 ? 'like' : 'likes'} · {p.commentCount} {p.commentCount === 1 ? 'comment' : 'comments'}</span>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>{(p.text || '').slice(0, 160)}{(p.text || '').length > 160 ? '…' : ''}</div>
                </div>
                <Button className="btn-sm" variant="reject" onClick={() => remove(p.id)}>Delete</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
