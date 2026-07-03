// Data store + journal review-workflow engine.
//
// This is the single source of truth the API routes read and mutate. The data
// itself comes from a pluggable provider (in-memory seed, or Google Sheets),
// selected by the DATA_PROVIDER env var. The workflow logic below is identical
// either way; only load() / persist() differ, so routes and UI never change.

import { randomBytes } from 'node:crypto';
import { STAGE, STAGE_LABEL, EDITOR_ROLES, ASSOCIATE_TOTAL_ROUNDS, TASK_STATUS, freshOnboarding, CATEGORIES } from './domain.js';
import * as seed from './seed.js';
import { verifyPassword, hashPassword } from './passwords.js';
import { safeUrl } from './url.js';
import { notifyMove, notifyEvent } from './notify.js';
import { emailDecision, sendEmail, actionEmail } from './email.js';
import { registerDoi, journalIssn, journalUrl } from './doi.js';
import { generateSecret as totpGenerateSecret, otpauthUrl as totpOtpauthUrl, verifyTotp } from './totp.js';

// Deep clone the seed so a reset returns to a clean baseline.
const clone = (x) => JSON.parse(JSON.stringify(x));

let db;
let provider = null; // null => in-memory (no persistence)

// Fresh in-memory dataset from the seed module.
function buildSeed() {
  return {
    editors: clone(seed.editors),
    researchers: clone(seed.researchers),
    submissions: clone(seed.submissions),
    publications: clone(seed.publications),
    journalIssues: clone(seed.journalIssues || []),
    projects: clone(seed.projects),
    listings: clone(seed.listings),
    applications: clone(seed.applications),
    proposals: clone(seed.proposals || []),
    chapters: clone(seed.chapters),
    news: clone(seed.news),
    audit: clone(seed.audit),
    notifications: clone(seed.notifications),
    events: clone(seed.events || []),
    programs: clone(seed.programs || []),
    certificates: clone(seed.certificates || []),
    groups: clone(seed.groups || []),
    competitions: clone(seed.competitions || []),
    posts: clone(seed.posts || []),
    activities: clone(seed.activities || []),
    messages: clone(seed.messages || []),
    reports: clone(seed.reports || []),
    preprints: clone(seed.preprints || []),
    // Expertise-mentor 1:1 bookings (ROLE_WORKFLOWS §7). Mentor profile + slots
    // live on the researcher record; this collection holds the booked calls.
    mentorBookings: clone(seed.mentorBookings || []),
    chapterProgress: [],
  };
}

// Push an in-app notification to a user (fire-and-forget within mutations).
function pushNotif(userId, { type, title, body, link }) {
  if (!userId || !db.notifications) return;
  db.notifications.push({
    id: `ntf_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    userId,
    type: type || 'info',
    title,
    body: body || '',
    link: link || '',
    read: false,
    at: new Date().toISOString(),
  });
  emit(userId, 'notification', { title, body, link });
}

// Notify every editor who reviewed a paper (per policy: reviewers are told when
// a paper they reviewed advances or publishes — and learn the author on publish).
function notifyReviewers(sub, title, body) {
  const ids = new Set([...(sub.assignedReviewers || []), ...sub.reviews.map((r) => r.editorId)]);
  for (const id of ids) pushNotif(id, { type: 'paper', title, body, link: '/editor' });
}

// Append an entry to the audit log.
function recordAudit(actor, action, detail) {
  if (!db.audit) db.audit = [];
  db.audit.push({
    id: `aud_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    at: new Date().toISOString(),
    actorId: actor?.id || actor?.editorId || null,
    actorName: actor?.name || 'system',
    action,
    detail: detail || '',
  });
}

// Audit a review-pipeline decision (every decision is logged for traceability,
// per JOURNAL_PIPELINE §6.6/§12). `stageName` is a human-readable stage label.
function auditDecision(sub, editorId, stageName, decision) {
  const verb = decision === 'approve' ? 'approved' : 'rejected';
  recordAudit(getEditorById(editorId), 'paper_decision', `${stageName} ${verb} ${sub.id} "${sub.title}"`);
}

// Assign reviewers to any submission sitting in the review stage without them
// (covers fresh seed data and rows imported from the Google Form).
function assignPendingReviewers() {
  db.submissions.forEach((s) => {
    if (s.stage === STAGE.REVIEW && (!s.assignedReviewers || s.assignedReviewers.length === 0)) {
      s.assignedReviewers = pickReviewers(s.category);
    }
  });
}

// Write-behind persistence: debounce so a burst of mutations writes once.
let persistTimer = null;
function schedulePersist() {
  if (!provider || typeof provider.persist !== 'function') return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    provider.persist(db).catch((e) => console.error('[store] persist failed:', e.message));
  }, 300);
}

// Pull the dataset from the active provider. A provider may return null (empty
// database on first boot) — start from the seed and let the write-behind
// persist establish it. Collections the provider doesn't know about yet (added
// after its data was created) are backfilled from the seed.
async function loadFromProvider() {
  const loaded = await provider.load();
  return loaded ? Object.assign(buildSeed(), loaded) : buildSeed();
}

// Guaranteed owner login. When ADMIN_EMAIL + ADMIN_PASSWORD are set, make sure
// an account with that email exists and uses that password — created as a
// platform admin if missing, password-reset if it exists. This is the escape
// hatch for production, where the shared demo password is refused at login and
// the seeded staff accounts would otherwise be unreachable.
function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) return;
  let u = [...db.editors, ...db.researchers].find((x) => x.email && x.email.toLowerCase() === email);
  if (u) {
    // Promote an EXISTING account (even one that signed up as a researcher) to
    // platform admin — move it into the editors list so it's a proper staff acct.
    if (u.kind !== 'editor') {
      db.researchers = db.researchers.filter((x) => x.id !== u.id);
      if (!db.editors.some((x) => x.id === u.id)) db.editors.push(u);
    }
  } else {
    const base = email.split('@')[0] || 'admin';
    const taken = (uname) => [...db.editors, ...db.researchers].some((x) => x.username.toLowerCase() === uname);
    const username = taken(base) ? `${base}.admin` : base;
    u = {
      id: `usr_admin_${Date.now()}`,
      name: 'Platform Admin',
      username,
      slug: username.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      institution: '', bio: '', avatarUrl: '', interests: [], links: [], following: [],
      twoFactorSecret: '',
      twoFactorEnabled: false,
    };
    db.editors.push(u);
  }
  // Force the platform-admin identity and clear any researcher-only gates
  // (approval / onboarding) so signing in goes straight to the admin dashboard.
  u.kind = 'editor';
  u.role = EDITOR_ROLES.ADMIN;
  u.category = u.category || '';
  u.password = hashPassword(password);
  u.emailVerified = true;
  u.approved = true;
  u.onboarded = true;
  u.suspended = false;
  if (u.public === undefined) u.public = false;
  console.log(`[store] admin bootstrap: ${email} signs in as platform admin (editor/admin)`);
}

// Safety net: collapse any accounts that share an email (case-insensitive) so a
// single person can never end up with two logins. Registration already blocks
// new duplicates; this heals data that predates that guard or arrived via an
// external provider. We keep one account per email — preferring a staff/editor
// account, then the oldest — and drop the rest.
function dedupeAccounts() {
  const seen = new Map(); // email -> kept account
  const rank = (u) => (u.kind === 'editor' ? 0 : 1); // editors win
  const age = (u) => (u.createdAt ? new Date(u.createdAt).getTime() : 0);
  const all = [...db.editors, ...db.researchers].filter((u) => u && u.email);
  let removed = 0;
  for (const u of all) {
    const key = u.email.toLowerCase();
    const kept = seen.get(key);
    if (!kept) { seen.set(key, u); continue; }
    // Decide which of the two to keep; mark the loser for removal.
    const keepNew = rank(u) < rank(kept) || (rank(u) === rank(kept) && age(u) && age(u) < age(kept));
    const loser = keepNew ? kept : u;
    if (keepNew) seen.set(key, u);
    db.editors = db.editors.filter((x) => x !== loser);
    db.researchers = db.researchers.filter((x) => x !== loser);
    removed += 1;
  }
  if (removed) console.log(`[store] dedupe: removed ${removed} duplicate-email account(s)`);
}

// Optional: create ready-to-use demo accounts from the DEMO_ACCOUNTS env var.
// The static seed only applies to a fresh database, so this is how the per-level
// demo logins get into an ALREADY-populated DB (e.g. prod Postgres). Runs every
// boot and is idempotent — an account is created only when its email is free.
//
// Format: one account per line (or ';'-separated), fields split by '|':
//   email|password|level[|Display Name]
// level ∈ lead | associate | chapter | independent (long *_researcher / *_leader
// forms also work). A JSON array of {email,password,level,name} is accepted too.
const DEMO_LEVELS = {
  lead: 'lead_researcher', lead_researcher: 'lead_researcher',
  associate: 'associate_researcher', associate_researcher: 'associate_researcher',
  chapter: 'chapter_leader', chapter_leader: 'chapter_leader', chapter_lead: 'chapter_leader',
  independent: 'independent_researcher', independent_researcher: 'independent_researcher', indie: 'independent_researcher',
};

function parseDemoAccounts(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map((a) => ({ email: a.email, password: a.password, level: a.level, name: a.name })); }
    catch { console.warn('[store] DEMO_ACCOUNTS: invalid JSON — ignoring'); return []; }
  }
  return s.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [email, password, level, name] = line.split('|').map((x) => (x || '').trim());
    return { email, password, level, name };
  });
}

function bootstrapDemoAccounts() {
  const specs = parseDemoAccounts(process.env.DEMO_ACCOUNTS);
  if (!specs.length) return;
  const everyone = () => [...db.editors, ...db.researchers];
  const taken = (uname) => everyone().some((x) => (x.username || '').toLowerCase() === uname);
  let created = 0;
  for (const spec of specs) {
    const email = (spec.email || '').trim().toLowerCase();
    const tag = DEMO_LEVELS[(spec.level || '').trim().toLowerCase()];
    if (!email || !spec.password || !tag) { console.warn(`[store] DEMO_ACCOUNTS: skipping malformed entry (${spec.email || '?'})`); continue; }
    if (everyone().some((x) => x.email && x.email.toLowerCase() === email)) continue; // already exists — leave it be

    let base = (email.split('@')[0] || 'member').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'member';
    let username = base, n = 1;
    while (taken(username)) username = `${base}${++n}`;
    db.researchers.push({
      id: `usr_demo_${Date.now()}_${created}`,
      name: spec.name || email.split('@')[0],
      username, slug: username,
      password: hashPassword(spec.password),
      kind: 'researcher',
      tags: [tag],
      email: spec.email.trim(),
      discord: username,
      resumeUrl: '', gpa: '', researchExperience: null, leadRecommended: false,
      pathway: [], institution: '', bio: '', avatarUrl: '', interests: [], links: [], following: [],
      public: true, emailVerified: true, approved: true, onboarded: true,
      twoFactorSecret: '', twoFactorEnabled: false, createdAt: now(),
    });
    created += 1;
  }
  if (created) { console.log(`[store] demo accounts: created ${created} account(s) from DEMO_ACCOUNTS`); schedulePersist(); }
}

// Boot-time heal: established researchers (approved + already assigned a role)
// predate the durable `onboarded` flag, so the intro wizard would nag them every
// login. They went through the pending-approval intake already, so mark them
// onboarded once. New / unapproved sign-ups still see onboarding.
function healLegacyOnboarding() {
  let healed = 0;
  for (const r of db.researchers || []) {
    if (r.onboarded !== true && r.approved === true && (r.tags || []).length > 0) {
      r.onboarded = true;
      healed += 1;
    }
  }
  if (healed) { console.log(`[store] onboarding heal: marked ${healed} established researcher(s) onboarded`); schedulePersist(); }
}

// Add seed demo/staff accounts that are missing from a loaded dataset (e.g. the
// in-memory server was started before a new demo account was added, or a
// persisted provider snapshot predates a seed update).
function backfillSeedAccounts() {
  const baseline = buildSeed();
  const known = new Set(
    [...db.editors, ...db.researchers]
      .map((u) => (u.email || u.username || '').trim().toLowerCase())
      .filter(Boolean),
  );
  let added = 0;
  for (const u of baseline.editors) {
    const key = (u.email || u.username || '').trim().toLowerCase();
    if (!key || known.has(key)) continue;
    db.editors.push(clone(u));
    known.add(key);
    added += 1;
  }
  for (const u of baseline.researchers) {
    const key = (u.email || u.username || '').trim().toLowerCase();
    if (!key || known.has(key)) continue;
    db.researchers.push(clone(u));
    known.add(key);
    added += 1;
  }
  if (added) console.log(`[store] backfill: added ${added} seed account(s)`);
}

// Load the active provider's data. Called once at server startup.
export async function init() {
  const name = (process.env.DATA_PROVIDER || 'memory').toLowerCase();
  if (name === 'sheets') {
    const { createSheetsProvider } = await import('./providers/sheets.js');
    provider = await createSheetsProvider();
    db = await loadFromProvider();
  } else if (name === 'postgres' || name === 'pg') {
    const { createPostgresProvider } = await import('./providers/postgres.js');
    provider = await createPostgresProvider();
    db = await loadFromProvider();
  } else {
    provider = null;
    db = buildSeed();
  }
  dedupeAccounts();
  backfillSeedAccounts();
  bootstrapAdmin();
  bootstrapDemoAccounts();
  healLegacyOnboarding();
  assignPendingReviewers();
  schedulePersist();
  console.log(`[store] data provider: ${name}`);
  return db;
}

// Reload baseline data (dev helper / "reset" route). Reloads from the active
// provider, or the seed when in memory.
export async function reset() {
  db = provider ? await loadFromProvider() : buildSeed();
  dedupeAccounts();
  backfillSeedAccounts();
  bootstrapAdmin();
  bootstrapDemoAccounts();
  healLegacyOnboarding();
  assignPendingReviewers();
  schedulePersist();
}

// --- helpers ---------------------------------------------------------------

const now = () => new Date().toISOString();
// Monotonic unique-id helper. Date.now() alone collides when several records are
// created within the same millisecond (e.g. rapid submissions) — the counter
// guarantees uniqueness.
let _idSeq = 0;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(_idSeq++).toString(36)}`;
const editorsByRole = (role, category) =>
  db.editors.filter((e) => e.role === role && (category ? e.category === category : true));

// Count how many ACTIVE papers each candidate editor currently owns, so we can
// hand the next paper to whoever has the lightest load (even distribution).
function loadOf(editorId) {
  let n = 0;
  for (const s of db.submissions) {
    if (s.stage === STAGE.PUBLISHED || s.stage === STAGE.REJECTED) continue;
    if (s.assignee === editorId) n++;
    if (s.assignedReviewers.includes(editorId)) n++;
  }
  return n;
}

// Pick the two least-loaded Reviews editors in the paper's category.
function pickReviewers(category) {
  const candidates = editorsByRole(EDITOR_ROLES.REVIEWS, category)
    .slice()
    .sort((a, b) => loadOf(a.id) - loadOf(b.id));
  return candidates.slice(0, 2).map((e) => e.id);
}

// Pick the single least-loaded editor of a role in a category.
function pickOne(role, category) {
  const candidates = editorsByRole(role, category)
    .slice()
    .sort((a, b) => loadOf(a.id) - loadOf(b.id));
  return candidates[0]?.id ?? null;
}

function log(sub, event) {
  sub.history.push({ at: now(), ...event });
}

// --- real-time event bus (SSE subscribers register here) -------------------
// Each subscriber is called with (targetUserId, type, data); the SSE endpoint
// filters to the connected user. No-op until anyone subscribes.
const _rtListeners = new Set();
export function subscribeRealtime(fn) { _rtListeners.add(fn); return () => _rtListeners.delete(fn); }
function emit(userId, type, data) {
  for (const fn of _rtListeners) { try { fn(userId, type, data); } catch { /* ignore */ } }
}

// --- activity stream (followers see what people they follow do) ------------
// Records a public-ish action (joined a group, advanced a paper, became a lead)
// so followers can see it in their feed. Capped to keep the snapshot bounded.
function recordActivity(actorId, type, text, link) {
  if (!actorId) return;
  if (!Array.isArray(db.activities)) db.activities = [];
  db.activities.push({ id: uid('act'), actorId, type, text, link: link || '', at: now() });
  if (db.activities.length > 3000) db.activities = db.activities.slice(-3000);
}

// Announce a meaningful new role (Lead Researcher / Chapter Leader) to followers.
function recordRoleActivity(userId, grantedTags) {
  const ROLE_TAGS = { lead_researcher: 'Lead Researcher', chapter_leader: 'Chapter Leader', independent_researcher: 'Independent Researcher' };
  for (const t of grantedTags || []) {
    if (ROLE_TAGS[t]) recordActivity(userId, 'role', `became a ${ROLE_TAGS[t]}`, `/p/${getUserById(userId)?.slug || userId}`);
  }
}

// --- read API --------------------------------------------------------------

export const getEditorById = (id) => db.editors.find((e) => e.id === id) || null;
export const getResearcherById = (id) => db.researchers.find((r) => r.id === id) || null;

export function authenticate(identifier, password) {
  // Seed/demo accounts all share this password. Refuse it in production so a
  // deployed instance can't be entered through well-known demo credentials.
  if (!demoLoginsEnabled() && password === 'demo1234') return null;
  const id = String(identifier || '').trim().toLowerCase();
  // Accept either a username or an email address (the smart sign-in enters email).
  const user = [...db.editors, ...db.researchers].find(
    (u) => u.username.toLowerCase() === id || (u.email && u.email.toLowerCase() === id),
  );
  if (!user || !verifyPassword(password, user.password)) return null;
  if (user.suspended) throw httpError(403, 'This account has been suspended. Contact an administrator.');
  const { password: _pw, twoFactorSecret: _s, ...safe } = user;
  return safe;
}

// Whether the shared demo password is accepted (always in dev; in production
// only when ALLOW_DEMO_LOGINS is set). Exposed via /api/config so the login
// page can hide its one-click demo buttons when they'd be refused.
export const demoLoginsEnabled = () =>
  process.env.NODE_ENV !== 'production' || !!process.env.ALLOW_DEMO_LOGINS;

// Smart sign-in: does an account exist for this email, and how does it log in?
// (password vs. Google-only). Lets the UI route to the right next step.
export function lookupEmail(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr) return { exists: false };
  const user = [...db.editors, ...db.researchers].find((u) => u.email && u.email.toLowerCase() === addr);
  if (!user) return { exists: false };
  const googleOnly = !!user.googleId && !user.password;
  return { exists: true, method: googleOnly ? 'google' : 'password', name: user.name };
}

// Google Sign-In: match an existing account by email (link the googleId) or
// create a new researcher. Returns a safe user.
export function findOrCreateGoogleUser({ email, name, googleId }) {
  const lower = email.toLowerCase();
  let user = [...db.editors, ...db.researchers].find((u) => u.email && u.email.toLowerCase() === lower);
  if (user) {
    user.googleId = googleId;
  } else {
    user = {
      id: `usr_${Date.now()}`,
      name: name || email,
      username: lower.split('@')[0],
      password: '', // Google-only account
      kind: 'researcher',
      tags: [],
      approved: true,
      onboarded: false,
      rolesIntroSeen: false,
      email,
      discord: '',
      resumeUrl: '',
      googleId,
      public: true,
      emailVerified: true, // Google verifies the email
    };
    db.researchers.push(user);
    claimProjectInvites(user);
    notifyEvent({ title: 'New member', body: `${user.name} joined Synthica (Google).` });
  }
  if (user.emailVerified === undefined) user.emailVerified = true;
  schedulePersist();
  const { password, ...safe } = user;
  return safe;
}

// --- public profiles (everyone) --------------------------------------------

const TAG_LABEL = {
  chapter_leader: 'Chapter Leader',
  associate_researcher: 'Associate Researcher',
  lead_researcher: 'Lead Researcher',
  independent_researcher: 'Independent Researcher',
  expertise_mentor: 'Expertise Mentor',
};
const EDITOR_ROLE_LABEL = {
  reviews: 'Reviews Editor',
  associate: 'Associate Editor',
  senior: 'Senior Editor',
  chief: 'Editor-in-Chief',
  director: 'Director',
  auditor: 'Auditor',
  admin: 'Platform Admin',
};

function roleDisplay(u) {
  if (u.kind === 'editor') return (EDITOR_ROLE_LABEL[u.role] || 'Editor') + (u.category ? ` — ${u.category}` : '');
  return (u.tags || []).map((t) => TAG_LABEL[t] || t).join(', ') || 'Researcher';
}

export const getUserById = (id) => getEditorById(id) || getResearcherById(id);
const getUserBySlug = (slug) => [...db.editors, ...db.researchers].find((u) => u.slug === slug);

function publicProfileOf(u) {
  const publications = db.publications
    .filter((p) => p.authorUserId === u.id || (p.authorUserIds || []).includes(u.id) || (p.taggedUserIds || []).includes(u.id))
    .map((p) => ({
      doi: p.doi, title: p.title, category: p.category, publishedAt: p.publishedAt,
      articleType: p.articleType, pdfUrl: p.pdfUrl || '', sourceUrl: p.sourceUrl || '',
      verified: p.verified !== false,
    }))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const currentProjects = db.projects
    .filter((p) => p.members.includes(u.id))
    .map((p) => ({
      id: p.id, title: p.title, category: p.category,
      // The member's role on the project auto-surfaces on their profile.
      role: (p.roles || []).find((r) => r.userId === u.id)?.title || (p.leadId === u.id ? 'Project Lead' : ''),
    }));
  // Affiliations: prefer the new multi-slot field, fall back to the legacy
  // single institution so older records still show something.
  const affiliations = (u.affiliations && u.affiliations.length)
    ? u.affiliations
    : (u.institution ? [u.institution] : []);
  return {
    id: u.id, slug: u.slug || u.id, username: u.username || '', name: u.name, kind: u.kind, role: roleDisplay(u),
    tags: u.tags || [],
    institution: affiliations[0] || '', affiliations,
    bio: u.bio || '', blurb: u.blurb || '', avatarUrl: u.avatarUrl || '',
    pronouns: u.pronouns || '',
    interests: u.interests || [],
    researchGroup: u.researchGroup || '', researchGroupUrl: u.researchGroupUrl || '',
    contactEmail: u.contactEmail || '',
    linkedinUrl: u.linkedinUrl || '', websiteUrl: u.websiteUrl || '',
    githubUrl: u.githubUrl || '', twitterUrl: u.twitterUrl || '', scholarUrl: u.scholarUrl || '', orcid: u.orcid || '',
    // DOB is sensitive (this is a platform for minors) — only ever exposed when
    // the member explicitly opts in via dobPublic.
    dob: u.dobPublic ? (u.dob || '') : '',
    links: u.links || [], category: u.category || null, currentProjects, publications,
    groups: (db.groups || []).filter((g) => (g.members || []).includes(u.id)).map((g) => ({ id: g.id, name: g.name })),
    badges: badgesFor(u.id), reputation: reputationFor(u.id),
    // Expertise-mentor profile (only meaningful when the mentor tag is held).
    specialties: u.specialties || [],
    mentorBio: u.mentorBio || '',
  };
}

// A member is publicly visible once approved (editors always are) and not
// opted out — unapproved sign-ups stay invisible until an auditor admits them.
const isVisible = (u) => u.public !== false && u.approved !== false;

// Resolve a profile by id OR stable slug — links never change.
export function getPublicProfile(key) {
  const u = getUserById(key) || getUserBySlug(key);
  if (!u || !isVisible(u)) return null;
  return publicProfileOf(u);
}

// Count a profile view (skipping the owner's own visits). Low-stakes vanity
// metric; the debounced persist coalesces bursts.
export function recordProfileView(key, viewerId) {
  const u = getUserById(key) || getUserBySlug(key);
  if (!u || !isVisible(u)) return;
  if (viewerId && viewerId === u.id) return;
  u.profileViews = (u.profileViews || 0) + 1;
  schedulePersist();
}

const pubCountFor = (userId) => db.publications.filter((p) => p.authorUserId === userId || (p.authorUserIds || []).includes(userId) || (p.taggedUserIds || []).includes(userId)).length;
const refCountFor = (userId) => db.researchers.filter((r) => r.referredBy === userId).length;

// Achievement badges, computed from a member's activity.
const BADGE_DEFS = [
  { id: 'published', label: 'Published Researcher', icon: 'scroll', earned: (u) => pubCountFor(u.id) > 0 },
  { id: 'lead', label: 'Project Lead', icon: 'compass', earned: (u) => db.projects.some((p) => p.leadId === u.id) },
  { id: 'founder', label: 'Group Founder', icon: 'building', earned: (u) => (db.groups || []).some((g) => g.leaderId === u.id) },
  { id: 'cohort', label: 'Cohort Member', icon: 'graduation-cap', earned: (u) => (db.programs || []).some((pr) => (pr.cohort || []).includes(u.id)) },
  { id: 'chapter', label: 'Chapter Leader', icon: 'globe', earned: (u) => (db.chapters || []).some((c) => c.leaderId === u.id) },
  { id: 'connector', label: 'Connector', icon: 'handshake', earned: (u) => refCountFor(u.id) >= 3 },
  { id: 'contributor', label: 'Community Contributor', icon: 'message', earned: (u) => postCountFor(u.id) >= 5 },
];

export function badgesFor(userId) {
  const u = getUserById(userId);
  if (!u) return [];
  return BADGE_DEFS.filter((b) => b.earned(u)).map(({ id, label, icon }) => ({ id, label, icon }));
}

// Reputation = a weighted sum of contributions (drives future rewards/ranking).
export function reputationFor(userId) {
  return pubCountFor(userId) * 50
    + db.projects.filter((p) => p.leadId === userId).length * 25
    + (db.groups || []).filter((g) => g.leaderId === userId).length * 20
    + refCountFor(userId) * 10
    + postCountFor(userId) * 3;
}

// Personal stats for the member's own dashboard (LinkedIn-style).
export function myStats(userId) {
  const u = getUserById(userId);
  return {
    profileViews: u?.profileViews || 0,
    posts: postCountFor(userId),
    projects: db.projects.filter((p) => p.members.includes(userId)).length,
    groups: (db.groups || []).filter((g) => (g.members || []).includes(userId)).length,
    referrals: refCountFor(userId),
    publications: pubCountFor(userId),
    reputation: reputationFor(userId),
    badges: badgesFor(userId),
  };
}

// Global search across people, projects (the viewer's), groups, and publications.
export function searchAll(query, viewerId) {
  const q = String(query || '').trim().toLowerCase();
  const empty = { people: [], projects: [], groups: [], publications: [] };
  if (q.length < 2) return empty;
  const has = (s) => String(s || '').toLowerCase().includes(q);
  const people = [...db.editors, ...db.researchers]
    .filter(isVisible)
    .filter((u) => has(u.name) || has(u.username) || has(u.institution) || (u.interests || []).some(has))
    .slice(0, 8)
    .map((u) => ({ id: u.id, slug: u.slug || u.id, name: u.name, role: roleDisplay(u), avatarUrl: u.avatarUrl || '', institution: u.institution || '' }));
  // Only the viewer's own projects (project pages require membership).
  const projects = db.projects
    .filter((p) => p.members.includes(viewerId) && (has(p.title) || has(p.category) || has(p.description)))
    .slice(0, 8)
    .map((p) => ({ id: p.id, title: p.title, category: p.category }));
  const groups = (db.groups || [])
    .filter((g) => has(g.name) || has(g.category) || has(g.description))
    .slice(0, 8)
    .map((g) => ({ id: g.id, name: g.name, category: g.category, memberCount: (g.members || []).length }));
  const publications = db.publications
    .filter((p) => p.verified !== false && (has(p.title) || (p.authors || []).some((a) => has(a.name))))
    .slice(0, 8)
    .map((p) => ({ id: p.id, title: p.title, doi: p.doi, category: p.category }));
  return { people, projects, groups, publications };
}

export function listProfiles() {
  return [...db.editors, ...db.researchers]
    .filter(isVisible)
    .map((u) => ({
      id: u.id, slug: u.slug || u.id, username: u.username || '', name: u.name, role: roleDisplay(u),
      institution: u.institution || '', blurb: u.blurb || '', avatarUrl: u.avatarUrl || '', kind: u.kind,
    }));
}

const cleanLinks = (arr) =>
  arr
    .map((l) => ({ label: String((l && l.label) || (l && l.url) || '').slice(0, 40), url: safeUrl(l && l.url) }))
    .filter((l) => l.url)
    .slice(0, 6);

export function updateProfile(userId, patch) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (typeof patch.name === 'string' && patch.name.trim()) u.name = patch.name.trim().slice(0, 80);
  if (typeof patch.institution === 'string') u.institution = patch.institution.trim().slice(0, 120);
  if (typeof patch.bio === 'string') u.bio = patch.bio.slice(0, 1000);
  if (typeof patch.blurb === 'string') u.blurb = patch.blurb.trim().slice(0, 140);
  if (patch.congratsSeen === true) u.newRoleCongrats = null;
  // URL fields run through safeUrl() — they render as <a href>/<img src> on
  // public pages, so a javascript:/data: scheme would be stored XSS.
  if (typeof patch.avatarUrl === 'string') u.avatarUrl = safeUrl(patch.avatarUrl, 400);
  if (typeof patch.resumeUrl === 'string') u.resumeUrl = safeUrl(patch.resumeUrl, 400);
  if (typeof patch.discord === 'string') u.discord = patch.discord.trim().slice(0, 60);
  if (typeof patch.linkedinUrl === 'string') u.linkedinUrl = safeUrl(patch.linkedinUrl);
  if (typeof patch.websiteUrl === 'string') u.websiteUrl = safeUrl(patch.websiteUrl);
  if (typeof patch.githubUrl === 'string') u.githubUrl = safeUrl(patch.githubUrl);
  if (typeof patch.twitterUrl === 'string') u.twitterUrl = safeUrl(patch.twitterUrl);
  if (typeof patch.scholarUrl === 'string') u.scholarUrl = safeUrl(patch.scholarUrl);
  if (typeof patch.orcid === 'string') u.orcid = patch.orcid.trim().slice(0, 60);
  if (typeof patch.pronouns === 'string') u.pronouns = patch.pronouns.trim().slice(0, 40);
  if (typeof patch.contactEmail === 'string') u.contactEmail = patch.contactEmail.trim().slice(0, 120);
  if (typeof patch.researchGroup === 'string') u.researchGroup = patch.researchGroup.trim().slice(0, 120);
  if (typeof patch.researchGroupUrl === 'string') u.researchGroupUrl = safeUrl(patch.researchGroupUrl);
  // Date of birth (YYYY-MM-DD) — stored, but only shown publicly if dobPublic.
  if (typeof patch.dob === 'string') u.dob = patch.dob.trim().slice(0, 10);
  if (typeof patch.dobPublic === 'boolean') u.dobPublic = patch.dobPublic;
  // Up to two affiliations; mirror the first into the legacy institution field
  // so the People list and website role line keep working.
  if (Array.isArray(patch.affiliations)) {
    u.affiliations = patch.affiliations.map((s) => String(s).trim().slice(0, 120)).filter(Boolean).slice(0, 2);
    u.institution = u.affiliations[0] || '';
  }
  if (Array.isArray(patch.interests)) u.interests = patch.interests.map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
  if (Array.isArray(patch.links)) u.links = cleanLinks(patch.links);
  if (typeof patch.public === 'boolean') u.public = patch.public;
  // Durable onboarding completion (so the wizard never re-shows on a new device).
  if (patch.onboarded === true) u.onboarded = true;
  if (patch.rolesIntroSeen === true) u.rolesIntroSeen = true;
  if (typeof patch.experienceSummary === 'string') u.experienceSummary = patch.experienceSummary.slice(0, 800);
  if (patch.gpa !== undefined) u.gpa = String(patch.gpa).trim().slice(0, 12);
  if (patch.researchExperience !== undefined && patch.researchExperience !== null && patch.researchExperience !== '') {
    const exp = Math.max(0, Math.min(10, Number(patch.researchExperience) || 0));
    u.researchExperience = exp;
    // High self-rated experience flags the researcher for a Lead Researcher nudge.
    if (exp >= 8) u.leadRecommended = true;
  }
  if (patch.leadershipExperience !== undefined && patch.leadershipExperience !== null && patch.leadershipExperience !== '') {
    u.leadershipExperience = Math.max(0, Math.min(10, Number(patch.leadershipExperience) || 0));
  }
  if (typeof patch.wantsChapterLead === 'boolean') u.wantsChapterLead = patch.wantsChapterLead;
  // Returning members from the old system: claim prior Lead status + the
  // project they ran. The project is only created if an auditor approves them
  // as a Lead Researcher.
  if (typeof patch.priorLead === 'boolean') u.priorLead = patch.priorLead;
  if (patch.legacyProject !== undefined) {
    const lp = patch.legacyProject;
    u.legacyProject = lp && lp.title?.trim()
      ? { title: String(lp.title).trim().slice(0, 140), category: CATEGORIES.includes(lp.category) ? lp.category : '', description: String(lp.description || '').slice(0, 600) }
      : null;
  }
  schedulePersist();
  const { password, twoFactorSecret, ...safe } = u;
  return safe;
}

/** Instant self-serve Associate Researcher role (after onboarding). */
export function claimAssociateRole(userId) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  if (!u.onboarded) throw httpError(403, 'Complete your profile setup first');
  if (!Array.isArray(u.tags)) u.tags = [];
  if (u.tags.includes('associate_researcher')) {
    const { password, twoFactorSecret, ...safe } = u;
    return safe;
  }
  u.tags.push('associate_researcher');
  u.approved = true;
  u.rolesIntroSeen = true;
  recordRoleActivity(u.id, ['associate_researcher']);
  u.newRoleCongrats = TAG_LABEL.associate_researcher;
  schedulePersist();
  const { password, twoFactorSecret, ...safe } = u;
  return safe;
}

// --- admin: people lookup + role management (multi-role enabler) ------------

// Suspend / reactivate a member (suspended accounts can't sign in).
export function setUserSuspended({ userId, suspended, actor }) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (u.id === actor?.id) throw httpError(400, "You can't suspend yourself");
  u.suspended = !!suspended;
  recordAudit(actor, suspended ? 'suspend_user' : 'reactivate_user', u.name);
  schedulePersist();
  return { id: u.id, suspended: u.suspended };
}

// Recipients for an admin email broadcast.
export function broadcastRecipients(audience) {
  const pick = audience === 'researchers' ? db.researchers
    : audience === 'editors' ? db.editors
    : [...db.editors, ...db.researchers];
  return pick
    .filter((u) => u.email && !u.suspended && u.approved !== false)
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
}

export function adminListUsers(q) {
  const needle = (q || '').toLowerCase();
  return [...db.editors, ...db.researchers]
    .filter((u) => !needle || u.name.toLowerCase().includes(needle) || (u.email || '').toLowerCase().includes(needle) || (u.username || '').toLowerCase().includes(needle))
    .map((u) => ({
      id: u.id, name: u.name, email: u.email, username: u.username, kind: u.kind,
      role: u.role || null, category: u.category || null, tags: u.tags || [],
      // Onboarding signals so auditors can re-evaluate roles later, not just at sign-up.
      approved: u.approved !== false,
      suspended: !!u.suspended,
      researchExperience: u.researchExperience ?? null,
      leadershipExperience: u.leadershipExperience ?? null,
      wantsChapterLead: !!u.wantsChapterLead,
      gpa: u.gpa || '',
      resumeUrl: u.resumeUrl || '',
      experienceSummary: u.experienceSummary || '',
      priorLead: !!u.priorLead,
      legacyProject: u.legacyProject || null,
      recommendation: u.kind === 'researcher' ? recommendRole(u) : null,
    }));
}

// Set a user's editor role/category and/or add/remove researcher tags. Lets an
// admin promote anyone (e.g. make a researcher a Lead, or grant editor rights).
export function adminSetUserRole({ userId, kind, role, category, addTags, removeTags, actor }) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (kind === 'editor' || kind === 'researcher') u.kind = kind;
  if (role !== undefined) u.role = role || null;
  if (category !== undefined) u.category = category || null;
  if (!Array.isArray(u.tags)) u.tags = [];
  const grantedAdmin = [];
  if (Array.isArray(addTags)) addTags.forEach((t) => { if (!u.tags.includes(t)) { u.tags.push(t); grantedAdmin.push(t); } });
  if (Array.isArray(removeTags)) u.tags = u.tags.filter((t) => !removeTags.includes(t));
  u.approved = true; // an admin acting on the account activates it
  if ((addTags || []).includes('lead_researcher')) restoreLegacyProject(u, actor?.id);
  recordRoleActivity(u.id, grantedAdmin);
  recordAudit(actor, 'set_role', `${u.name}: kind=${u.kind} role=${u.role || '-'} tags=[${u.tags.join(',')}]`);
  schedulePersist();
  const { password, twoFactorSecret, ...safe } = u;
  return safe;
}

// Bulk-assign a researcher tag (or editor role) to many users by email list.
export function adminBulkRole({ emails, tag, role, actor }) {
  const list = String(emails || '').split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const updated = [];
  const notFound = [];
  for (const email of list) {
    const u = getUserByEmail(email);
    if (!u) { notFound.push(email); continue; }
    if (tag) { if (!Array.isArray(u.tags)) u.tags = []; if (!u.tags.includes(tag)) u.tags.push(tag); }
    if (role) { u.kind = 'editor'; u.role = role; }
    updated.push(u.name);
  }
  recordAudit(actor, 'bulk_role', `${tag || role} → ${updated.length} users`);
  schedulePersist();
  return { updated, notFound };
}

// --- two-factor (TOTP) -----------------------------------------------------

export function startTwoFactorSetup(userId) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!u.twoFactorSecret || u.twoFactorEnabled) u.twoFactorSecret = totpGenerateSecret();
  schedulePersist();
  return { secret: u.twoFactorSecret, otpauthUrl: totpOtpauthUrl(u.twoFactorSecret, u.email || u.username) };
}

export function enableTwoFactor(userId, code) {
  const u = getUserById(userId);
  if (!u || !u.twoFactorSecret) throw httpError(400, 'Start setup first');
  if (!verifyTotp(u.twoFactorSecret, code)) throw httpError(400, 'Invalid code');
  u.twoFactorEnabled = true;
  schedulePersist();
  return { ok: true };
}

export function disableTwoFactor(userId, code) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (u.twoFactorEnabled && !verifyTotp(u.twoFactorSecret, code)) throw httpError(400, 'Invalid code');
  u.twoFactorEnabled = false;
  u.twoFactorSecret = '';
  schedulePersist();
  return { ok: true };
}

// Used by the login flow.
export function twoFactorRequired(userId) {
  const u = getUserById(userId);
  return !!(u && u.twoFactorEnabled);
}
export function verifyTwoFactorCode(userId, code) {
  const u = getUserById(userId);
  return !!(u && verifyTotp(u.twoFactorSecret, code));
}

// Hide author identity from Reviews editors (single-blind, per editorial policy).
function anonymizeForReviews(s) {
  return {
    ...s,
    authorName: 'Anonymous author',
    authorEmail: null,
    authorDiscord: null,
    submittedBy: null,
    revisions: (s.revisions || []).map((r) => ({ ...r, byName: 'Author' })),
  };
}

// Decorate a submission for API responses: attach editor names + stage label.
function decorate(sub) {
  return {
    ...sub,
    comments: sub.comments || [],
    revisions: sub.revisions || [],
    stageLabel: STAGE_LABEL[sub.stage],
    assignedReviewerNames: sub.assignedReviewers.map((id) => getEditorById(id)?.name).filter(Boolean),
    assigneeName: sub.assignee ? getEditorById(sub.assignee)?.name : null,
  };
}

// Internal editor comment thread on a paper (visible to all editors who can see
// it). Separate from the decision feed.
export function addPaperComment({ paperId, editorId, body }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (!body?.trim()) throw httpError(400, 'A comment is required');
  const editor = getEditorById(editorId);
  if (!sub.comments) sub.comments = [];
  const c = { id: `cmt_${Date.now()}`, authorId: editorId, authorName: editor?.name || 'Editor', role: editor?.role || null, body: body.trim(), at: now() };
  sub.comments.push(c);
  schedulePersist();
  return c;
}

// Director: swap one assigned reviews-editor for another (same category) while a
// paper is still in the review stage.
export function reassignReviewer({ paperId, fromEditorId, toEditorId }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.stage !== STAGE.REVIEW) throw httpError(409, 'Paper is no longer in the review stage');
  const to = getEditorById(toEditorId);
  if (!to || to.role !== EDITOR_ROLES.REVIEWS || to.category !== sub.category)
    throw httpError(400, 'Pick a reviews editor in the paper’s category');
  if (sub.assignedReviewers.includes(toEditorId)) throw httpError(409, 'That editor is already assigned');
  const idx = sub.assignedReviewers.indexOf(fromEditorId);
  if (idx === -1) throw httpError(404, 'That editor is not assigned to this paper');
  sub.assignedReviewers[idx] = toEditorId;
  // Drop any review the removed editor had already left.
  sub.reviews = sub.reviews.filter((r) => r.editorId !== fromEditorId);
  log(sub, { type: 'reassign', from: fromEditorId, to: toEditorId });
  schedulePersist();
  return decorate(sub);
}

// Active workload per editor (for balancing decisions).
export function editorWorkload() {
  return db.editors
    .filter((e) => e.role !== EDITOR_ROLES.DIRECTOR)
    .map((e) => ({ id: e.id, name: e.name, role: e.role, category: e.category, load: loadOf(e.id) }))
    .sort((a, b) => b.load - a.load);
}

// Reassignment board: review-stage papers with their two assigned Reviews
// editors and the other eligible (same-category) reviewers the Director could
// swap in. Drives the "Reassign a reviews editor" panel on the Director desk.
export function directorReassignBoard() {
  return db.submissions
    .filter((s) => s.stage === STAGE.REVIEW)
    .map((s) => {
      const assigned = s.assignedReviewers.map((id) => {
        const e = getEditorById(id);
        return { id, name: e?.name || 'Unknown editor', reviewed: s.reviews.some((r) => r.editorId === id), load: loadOf(id) };
      });
      const candidates = db.editors
        .filter((e) => e.role === EDITOR_ROLES.REVIEWS && e.category === s.category && !s.assignedReviewers.includes(e.id))
        .map((e) => ({ id: e.id, name: e.name, load: loadOf(e.id) }))
        .sort((a, b) => a.load - b.load);
      return { paperId: s.id, title: s.title, category: s.category, assigned, candidates };
    });
}

// Papers visible to a given editor, scoped by role + category + assignment.
export function papersForEditor(editorId) {
  const editor = getEditorById(editorId);
  if (!editor) return [];

  const inbox = [];
  const archive = [];

  for (const raw of db.submissions) {
    const s = decorate(raw);
    const myReview = raw.reviews.find((r) => r.editorId === editorId);

    switch (editor.role) {
      case EDITOR_ROLES.REVIEWS: {
        // Reviews editors see the paper single-blind (no author identity).
        const anon = anonymizeForReviews(s);
        const coReview = raw.reviews.find((r) => r.editorId !== editorId && raw.assignedReviewers.includes(r.editorId));
        if (raw.stage === STAGE.REVIEW && raw.assignedReviewers.includes(editorId)) {
          // Live peer visibility: when the OTHER reviews editor has already
          // submitted, surface their full decision + feedback + recommendation.
          inbox.push({
            ...anon,
            myReview: myReview || null,
            coReviewerDecision: coReview?.decision || null,
            coReview: coReview ? coReviewView(coReview) : null,
          });
        } else if (raw.assignedReviewers.includes(editorId) && myReview) {
          archive.push({ ...anon, myReview, coReview: coReview ? coReviewView(coReview) : null });
        }
        break;
      }

      case EDITOR_ROLES.SENIOR:
        // Senior screening (§9.2) and final check (§9.4) both need the full
        // reviews chain — decisions, feedback AND recommendations — so priorFeedback
        // (decision + comments per editor, role-tagged) goes to both stages.
        if ((raw.stage === STAGE.SENIOR_SCREEN || raw.stage === STAGE.SENIOR_FINAL) && raw.assignee === editorId) {
          inbox.push({ ...s, reviewerRecommendations: reviewerRecs(raw), priorFeedback: priorFeedback(raw), feed: buildFeed(raw) });
        } else if (raw.assignee === editorId && myReview) {
          archive.push({ ...s, reviewerRecommendations: reviewerRecs(raw), priorFeedback: priorFeedback(raw), feed: buildFeed(raw) });
        }
        break;

      case EDITOR_ROLES.ASSOCIATE:
        if (raw.stage === STAGE.ASSOCIATE && raw.assignee === editorId) {
          inbox.push({ ...s, reviewerRecommendations: reviewerRecs(raw), priorFeedback: priorFeedback(raw), feed: buildFeed(raw) });
        }
        break;

      case EDITOR_ROLES.CHIEF:
        if (raw.stage === STAGE.CHIEF) inbox.push({ ...s, reviewerRecommendations: reviewerRecs(raw), priorFeedback: priorFeedback(raw), feed: buildFeed(raw) });
        break;

      default:
        break;
    }
  }
  return { inbox, archive };
}

function reviewerRecs(sub) {
  return sub.reviews
    .filter((r) => r.recommendation)
    .map((r) => ({ editorName: getEditorById(r.editorId)?.name, recommendation: r.recommendation }));
}

// One reviews editor's submission as the peer reviewer sees it (single-blind:
// the co-reviewer is identified by role, never by author identity).
function coReviewView(r) {
  return {
    decision: r.decision,
    comments: r.comments,
    recommendation: r.recommendation || null,
    at: r.at,
  };
}

// Full prior decision chain, role-tagged so each upstream stage can be labelled
// (Reviews Editor / Senior Editor). Used by senior, associate and chief views.
function priorFeedback(sub) {
  return sub.reviews.map((r) => ({
    editorName: getEditorById(r.editorId)?.name,
    role: getEditorById(r.editorId)?.role || null,
    decision: r.decision,
    comments: r.comments,
    recommendation: r.recommendation || null,
  }));
}

// A chronological activity feed for a paper — every layer's votes, comments,
// recommendations, revision rounds, and the chief's call — so anyone above can
// see the whole history collectively. (Editor names + roles attached.)
function buildFeed(sub) {
  const entries = sub.reviews.map((r) => {
    const e = getEditorById(r.editorId);
    return {
      kind: 'review',
      editorName: e?.name || 'Editor',
      role: e?.role || null,
      decision: r.decision,
      comments: r.comments,
      recommendation: r.recommendation || null,
      at: r.at,
    };
  });
  for (const h of sub.history) {
    if (h.type === 'associate_round') {
      entries.push({
        kind: 'round',
        editorName: getEditorById(h.editorId)?.name || 'Associate editor',
        role: EDITOR_ROLES.ASSOCIATE,
        round: h.round,
        comments: h.note || null,
        at: h.at,
      });
    } else if (h.type === 'chief') {
      entries.push({ kind: 'chief', editorName: 'Editor-in-Chief', role: EDITOR_ROLES.CHIEF, decision: h.decision, comments: h.comments || null, at: h.at });
    }
  }
  return entries.sort((a, b) => new Date(a.at) - new Date(b.at));
}

// Director dashboard: every decision generates an email task; Chief-approved
// papers wait in the publish queue until the Director mints a DOI.
//   toEmail   — every approve/reject decision across all stages (mirror queue)
//   toPublish — READY_TO_PUBLISH: Chief-approved, not yet published by Director
//   published — already published (DOI minted, in the Archive) — for reference
export function directorView() {
  const toEmail = [];
  const toPublish = [];
  const published = [];
  for (const raw of db.submissions) {
    const s = decorate(raw);
    // "Papers to email": anything that has reached a notify-worthy decision point.
    for (const note of raw.history.filter((h) => h.notifyDirector)) {
      toEmail.push({
        paperId: raw.id,
        title: raw.title,
        authorName: raw.authorName,
        authorEmail: raw.authorEmail,
        category: raw.category,
        state: note.label,
        decision: note.decision,
        at: note.at,
        emailed: note.emailed || false,
        emailedAt: note.emailedAt || null,
      });
    }
    if (raw.stage === STAGE.PUBLISHED) {
      if (raw.published) {
        const pub = db.publications.find((p) => p.doi === raw.doi || p.title === raw.title);
        published.push({ ...s, doi: raw.doi || pub?.doi || null, publishedAt: raw.publishedAt || pub?.publishedAt || null });
      } else {
        toPublish.push(s);
      }
    }
  }
  // Newest decisions first so the Director acts on the freshest items up top.
  toEmail.sort((a, b) => new Date(b.at) - new Date(a.at));
  published.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return { toEmail, toPublish, published };
}

// --- write API: the workflow engine ---------------------------------------

const getSub = (id) => db.submissions.find((s) => s.id === id);

// A Reviews editor submits their decision on a paper.
// Requires feedback; recommendation required only when approving.
export function submitReviewDecision({ paperId, editorId, decision, comments, recommendation }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.stage !== STAGE.REVIEW) throw httpError(409, 'Paper is no longer in the review stage');
  if (!sub.assignedReviewers.includes(editorId)) throw httpError(403, 'You are not assigned to this paper');
  if (sub.reviews.some((r) => r.editorId === editorId)) throw httpError(409, 'You have already reviewed this paper');
  if (!comments?.trim()) throw httpError(400, 'Feedback is required');
  if (decision === 'approve' && !recommendation?.trim())
    throw httpError(400, 'A recommendation is required when approving');

  sub.reviews.push({ editorId, decision, comments, recommendation: recommendation || null, at: now() });
  log(sub, { type: 'review', editorId, decision });
  auditDecision(sub, editorId, 'Reviews Editor', decision);

  // Advance only once both assigned reviewers have weighed in.
  const both = sub.assignedReviewers.every((rid) => sub.reviews.some((r) => r.editorId === rid));
  if (both) {
    const allApproved = sub.assignedReviewers.every((rid) =>
      sub.reviews.find((r) => r.editorId === rid)?.decision === 'approve'
    );
    // Every paper — approved or declined — notifies the Director.
    if (allApproved) {
      advance(sub, STAGE.SENIOR_SCREEN, { label: STAGE_LABEL[STAGE.SENIOR_SCREEN], decision: 'approved' });
    } else {
      reject(sub, STAGE_LABEL[STAGE.SENIOR_SCREEN]); // both didn't agree -> decline
    }
  }
  schedulePersist();
  return decorate(sub);
}

// Senior editor screening (after reviews) OR final check (after associate).
export function seniorDecision({ paperId, editorId, decision, comments }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.stage !== STAGE.SENIOR_SCREEN && sub.stage !== STAGE.SENIOR_FINAL)
    throw httpError(409, 'Paper is not awaiting a senior decision');
  if (sub.assignee !== editorId) throw httpError(403, 'You are not assigned to this paper');
  if (!comments?.trim()) throw httpError(400, 'Feedback is required');

  sub.reviews.push({ editorId, decision, comments, recommendation: null, at: now() });
  const wasScreen = sub.stage === STAGE.SENIOR_SCREEN;
  log(sub, { type: 'senior', editorId, decision });
  auditDecision(sub, editorId, wasScreen ? 'Senior Editor (screening)' : 'Senior Editor (final)', decision);

  if (decision !== 'approve') {
    reject(sub, wasScreen ? STAGE_LABEL[STAGE.ASSOCIATE] : STAGE_LABEL[STAGE.CHIEF]);
  } else if (wasScreen) {
    advance(sub, STAGE.ASSOCIATE, { label: STAGE_LABEL[STAGE.ASSOCIATE], decision: 'approved' });
  } else {
    advance(sub, STAGE.CHIEF, { label: STAGE_LABEL[STAGE.CHIEF], decision: 'approved' });
  }
  schedulePersist();
  return decorate(sub);
}

// Associate editor logs a completed revision round; after the final round the
// paper goes to the Senior editor for the final check.
export function associateRound({ paperId, editorId, note }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.stage !== STAGE.ASSOCIATE) throw httpError(409, 'Paper is not with an associate editor');
  if (sub.assignee !== editorId) throw httpError(403, 'You are not assigned to this paper');
  if (sub.associateRounds >= ASSOCIATE_TOTAL_ROUNDS) throw httpError(409, 'All rounds already completed');

  sub.associateRounds += 1;
  log(sub, { type: 'associate_round', editorId, round: sub.associateRounds, note: note || null });
  recordAudit(getEditorById(editorId), 'associate_round', `${sub.id} "${sub.title}" — round ${sub.associateRounds}/${ASSOCIATE_TOTAL_ROUNDS}`);

  if (sub.associateRounds >= ASSOCIATE_TOTAL_ROUNDS) {
    advance(sub, STAGE.SENIOR_FINAL, { label: STAGE_LABEL[STAGE.SENIOR_FINAL], decision: 'approved' });
  }
  schedulePersist();
  return decorate(sub);
}

// Editor-in-chief final approval -> Director's publish queue.
export function chiefDecision({ paperId, editorId, decision, comments }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.stage !== STAGE.CHIEF) throw httpError(409, 'Paper is not awaiting the editor-in-chief');
  if (!comments?.trim()) throw httpError(400, 'Feedback is required');

  log(sub, { type: 'chief', editorId, decision, comments: comments.trim() });
  auditDecision(sub, editorId, 'Editor-in-Chief', decision);
  if (decision === 'approve') {
    advance(sub, STAGE.PUBLISHED, { label: STAGE_LABEL[STAGE.PUBLISHED], decision: 'approved' });
  } else {
    reject(sub, STAGE_LABEL[STAGE.PUBLISHED]);
  }
  schedulePersist();
  return decorate(sub);
}

// Director marks an author email as sent — timestamps the decision row.
export function markEmailed({ paperId, at }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  const note = sub.history.find((h) => h.notifyDirector && h.at === at);
  if (!note) throw httpError(404, 'No matching decision to mark emailed');
  if (!note.emailed) {
    note.emailed = true;
    note.emailedAt = now();
  }
  schedulePersist();
  return { emailedAt: note.emailedAt };
}

// Director publishes a finished paper into the journal DOI registry (Track 2).
// Chief approval parks the paper at STAGE.PUBLISHED (READY_TO_PUBLISH); this is
// the Director's act that mints the DOI, creates the public Publication, and
// notifies the author + reviewers that the paper is live.
export function publishToJournal({ paperId, doiSuffix, volume, issue, pages }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.stage !== STAGE.PUBLISHED) throw httpError(409, 'Paper is not ready to publish');
  if (sub.published) throw httpError(409, 'This paper has already been published');

  const today = now().slice(0, 10);
  // New papers land in the currently open issue unless the Director explicitly
  // overrides volume/issue (issue lifecycle lives further down in this file).
  const open = openJournalIssue();
  const pub = {
    id: `pub_${db.publications.length + 1}`,
    doi: doiSuffix ? `10.55555/synthica.${doiSuffix}` : nextSynthicaDoi(),
    title: sub.title,
    articleType: 'Article',
    authors: [{ name: sub.authorName, affiliation: 'Synthica Research Group' }],
    authorUserId: sub.submittedBy || null,
    correspondingAuthor: sub.authorName,
    category: sub.category,
    abstract: sub.abstract,
    keywords: [],
    receivedAt: sub.submittedAt.slice(0, 10),
    acceptedAt: today,
    publishedAt: today,
    volume: Number(volume) || open.volume,
    issue: Number(issue) || open.issue,
    pages: pages || '1–1',
    pdfUrl: sub.pdfUrl,
    license: 'CC BY 4.0',
    openAccess: true,
    sections: [
      { heading: 'Introduction', body: sub.abstract },
      { heading: 'Methods', body: 'See manuscript PDF.' },
      { heading: 'Results', body: 'See manuscript PDF.' },
      { heading: 'Discussion', body: 'See manuscript PDF.' },
    ],
    metrics: { accesses: 0, citations: 0, altmetric: 0 },
    citationCount: 0,
  };
  // Tagged co-authors get the paper on their profiles too.
  pub.authorUserIds = [...new Set([sub.submittedBy, ...(sub.coAuthorIds || [])].filter(Boolean))];
  pub.source = 'editorial';
  pub.verified = true;
  db.publications.push(pub);
  autoLinkPreprintForPublication(pub); // Phase 4: cross-link a matching preprint
  // Mark the submission published so it leaves the "Papers to publish" queue and
  // remember the DOI/date for the Director's "Published" reference list.
  sub.published = true;
  sub.doi = pub.doi;
  sub.publishedAt = pub.publishedAt;
  sub.history.push({ at: now(), type: 'published_to_journal', doi: pub.doi });
  recordAudit({ name: 'Director' }, 'publish', `${sub.title} (${pub.doi})`);
  registerDoi(pub); // optional Crossref deposit (no-op unless configured)
  // The paper is now live in the Archive: tell the author + reviewers and post
  // to the Discord queue. (Chief approval only announced acceptance.)
  emailDecision({ authorEmail: sub.authorEmail, authorName: sub.authorName, title: sub.title, decision: 'published' });
  notifyReviewers(sub, 'A paper you reviewed is now published', `"${sub.title}" · DOI ${pub.doi}`);
  notifyMove({ title: sub.title, paperId: sub.id, category: sub.category, label: `Published · DOI ${pub.doi}`, decision: 'published' });
  if (sub.submittedBy) {
    recordActivity(sub.submittedBy, 'published', `published “${sub.title}” in the Synthica Journal`, '/archive');
  }
  schedulePersist();
  return pub;
}

// --- paper archive (arXiv/Nature-style upload + self-archiving) -------------

const ARTICLE_TYPES = ['Article', 'Letter', 'Analysis', 'Review', 'Preprint', 'Dataset', 'Conference Paper'];

// Normalize an author list, preserving optional userId links to profiles.
// Look up a member by their global @username (case-insensitive, no @).
export const getUserByUsername = (username) => {
  const uname = String(username || '').replace(/^@/, '').trim().toLowerCase();
  return uname ? [...db.editors, ...db.researchers].find((u) => (u.username || '').toLowerCase() === uname) || null : null;
};

function cleanAuthors(list, fallbackName) {
  let authors = (Array.isArray(list) ? list : [])
    .map((a) => {
      // A "@username" tag (in the username field or as the name itself) links
      // the author to their Synthica profile — and must exist.
      const tag = a?.username || (String(a?.name || '').trim().startsWith('@') ? a.name : null);
      if (tag) {
        const u = getUserByUsername(tag);
        if (!u) throw httpError(400, `No member with the username ${String(tag).trim()} — check the spelling`);
        return { name: u.name, affiliation: u.institution || String(a?.affiliation || '').trim().slice(0, 160), userId: u.id };
      }
      return {
        name: String(a?.name || '').trim().slice(0, 120),
        affiliation: String(a?.affiliation || '').trim().slice(0, 160),
        userId: a?.userId ? String(a.userId) : null,
      };
    })
    .filter((a) => a.name);
  if (!authors.length && fallbackName) authors = [{ name: String(fallbackName).slice(0, 120), affiliation: '', userId: null }];
  return authors.slice(0, 30);
}

function nextSynthicaDoi() {
  const yr = new Date().getFullYear();
  const n = db.publications.length + 1;
  return `10.55555/synthica.${yr}.${String(n).padStart(4, '0')}`;
}

// Build a publication record from free-form input (admin upload or self-archive).
function buildPublication(input, { source, verified, addedBy, authorUserId }) {
  if (!input?.title?.trim()) throw httpError(400, 'A title is required');
  if (!CATEGORIES.includes(input.category)) throw httpError(400, 'Pick a valid subject category');
  const authors = cleanAuthors(input.authors, input.correspondingAuthor);
  if (!authors.length) throw httpError(400, 'At least one author is required');
  const primary = authorUserId || authors.find((a) => a.userId)?.userId || null;
  const authorUserIds = [...new Set([primary, ...authors.map((a) => a.userId)].filter(Boolean))];

  let publishedAt = String(input.publishedAt || '').slice(0, 10);
  if (!publishedAt && input.year) publishedAt = `${String(input.year).slice(0, 4)}-01-01`;
  if (!publishedAt) publishedAt = now().slice(0, 10);

  const keywords = Array.isArray(input.keywords)
    ? input.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 12)
    : String(input.keywords || '').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 12);

  const abstract = String(input.abstract || '').slice(0, 5000);
  // Full-text hosting: structured sections (Introduction, Methods, …) and a
  // reference list let the journal host the whole article, not just metadata.
  const sections = Array.isArray(input.sections)
    ? input.sections
        .filter((s) => s && (s.heading || s.body))
        .map((s) => ({ heading: String(s.heading || '').slice(0, 200), body: String(s.body || '').slice(0, 30000) }))
        .slice(0, 40)
    : [];
  const references = (Array.isArray(input.references)
    ? input.references
    : String(input.references || '').split('\n'))
    .map((r) => String(r).trim().slice(0, 600))
    .filter(Boolean)
    .slice(0, 300);
  return {
    id: uid('pub'),
    doi: String(input.doi || '').trim() || nextSynthicaDoi(),
    title: input.title.trim().slice(0, 300),
    articleType: ARTICLE_TYPES.includes(input.articleType) ? input.articleType : 'Article',
    authors,
    authorUserId: primary,
    authorUserIds,
    correspondingAuthor: authors[0].name,
    category: input.category,
    abstract,
    keywords,
    receivedAt: publishedAt,
    acceptedAt: publishedAt,
    publishedAt,
    volume: Number(input.volume) || null,
    issue: Number(input.issue) || null,
    pages: String(input.pages || '').slice(0, 20),
    pdfUrl: safeUrl(input.pdfUrl, 500),
    sourceUrl: safeUrl(input.sourceUrl, 500),
    license: String(input.license || 'CC BY 4.0').slice(0, 40),
    openAccess: input.openAccess !== false,
    sections, // full-text body (abstract is rendered separately)
    references, // bibliography
    metrics: { accesses: 0, citations: Number(input.citationCount) || 0, altmetric: 0 },
    citationCount: Number(input.citationCount) || 0,
    source,
    verified: !!verified,
    addedBy: addedBy || null,
  };
}

// Admin/auditor uploads a paper straight into the archive (trusted -> verified).
export function archivePublication(input, actor) {
  const pub = buildPublication(input, { source: 'archive', verified: true, addedBy: actor?.id });
  db.publications.push(pub);
  recordAudit(actor, 'archive_paper', `${pub.title} (${pub.doi})`);
  registerDoi(pub);
  schedulePersist();
  return pub;
}

// A researcher adds one of their past papers. Shows on their profile right away
// but stays unverified (out of the public archive) until an auditor confirms it.
export function addPastPaper(userId, input) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  let authors = cleanAuthors(input.authors, u.name);
  // Make sure the submitting researcher is linked as one of the authors.
  if (!authors.some((a) => a.userId === userId)) {
    const mine = authors.find((a) => a.name.toLowerCase() === u.name.toLowerCase());
    if (mine) mine.userId = userId;
    else authors = [{ name: u.name, affiliation: u.institution || '', userId }, ...authors];
  }
  const pub = buildPublication({ ...input, authors }, { source: 'self', verified: false, addedBy: userId, authorUserId: userId });
  db.publications.push(pub);
  recordAudit(u, 'add_past_paper', pub.title);
  notifyEvent({ title: 'Past paper submitted', body: `${u.name} added "${pub.title}" — needs verification.` });
  schedulePersist();
  return pub;
}

// Auditor verifies (approve -> public) or removes (reject) a self-archived paper.
export function verifyPublication({ id, status, reviewerId }) {
  const idx = db.publications.findIndex((p) => p.id === id);
  if (idx === -1) throw httpError(404, 'Publication not found');
  const pub = db.publications[idx];
  if (status === 'approved') {
    pub.verified = true;
    recordAudit({ id: reviewerId }, 'verify_paper', `${pub.title} (${pub.doi})`);
    if (pub.addedBy) pushNotif(pub.addedBy, { type: 'paper', title: 'Your archived paper was verified', body: pub.title, link: '/researcher/my-journal' });
    registerDoi(pub);
  } else if (status === 'rejected') {
    db.publications.splice(idx, 1);
    recordAudit({ id: reviewerId }, 'reject_paper', pub.title);
    if (pub.addedBy) pushNotif(pub.addedBy, { type: 'paper', title: 'Your archived paper was not approved', body: pub.title, link: '/researcher/my-journal' });
  } else {
    throw httpError(400, 'Invalid status');
  }
  schedulePersist();
  return { ok: true };
}

// Pin/unpin a paper at the top of the public archive (admin/auditor).
export function featurePublication({ id, featured, actor }) {
  const pub = db.publications.find((p) => p.id === id);
  if (!pub) throw httpError(404, 'Publication not found');
  pub.featured = !!featured;
  recordAudit(actor, featured ? 'feature_paper' : 'unfeature_paper', pub.title);
  schedulePersist();
  return pub;
}

// Admin edits a paper's metadata in place (typos, links, dates, keywords).
export function editPublication({ id, patch, actor }) {
  const pub = db.publications.find((p) => p.id === id);
  if (!pub) throw httpError(404, 'Publication not found');
  if (typeof patch.title === 'string' && patch.title.trim()) pub.title = patch.title.trim().slice(0, 300);
  if (patch.category && CATEGORIES.includes(patch.category)) pub.category = patch.category;
  if (typeof patch.articleType === 'string' && ARTICLE_TYPES.includes(patch.articleType)) pub.articleType = patch.articleType;
  if (typeof patch.abstract === 'string') pub.abstract = patch.abstract.slice(0, 5000);
  if (typeof patch.pdfUrl === 'string') pub.pdfUrl = safeUrl(patch.pdfUrl, 500);
  if (typeof patch.sourceUrl === 'string') pub.sourceUrl = safeUrl(patch.sourceUrl, 500);
  if (typeof patch.doi === 'string' && patch.doi.trim()) pub.doi = patch.doi.trim().slice(0, 120);
  if (patch.publishedAt) pub.publishedAt = String(patch.publishedAt).slice(0, 10);
  if (patch.volume !== undefined) pub.volume = Number(patch.volume) || null;
  if (patch.issue !== undefined) pub.issue = Number(patch.issue) || null;
  if (typeof patch.pages === 'string') pub.pages = patch.pages.slice(0, 20);
  if (patch.keywords !== undefined) {
    pub.keywords = (Array.isArray(patch.keywords) ? patch.keywords : String(patch.keywords).split(','))
      .map((k) => String(k).trim()).filter(Boolean).slice(0, 12);
  }
  if (patch.references !== undefined) {
    pub.references = (Array.isArray(patch.references) ? patch.references : String(patch.references).split('\n'))
      .map((r) => String(r).trim().slice(0, 600)).filter(Boolean).slice(0, 300);
  }
  if (Array.isArray(patch.sections)) {
    pub.sections = patch.sections
      .filter((s) => s && (s.heading || s.body))
      .map((s) => ({ heading: String(s.heading || '').slice(0, 200), body: String(s.body || '').slice(0, 30000) }))
      .slice(0, 40);
  }
  recordAudit(actor, 'edit_paper', `${pub.title} (${pub.doi})`);
  schedulePersist();
  return pub;
}

// Remove a publication from the archive (admin/auditor).
export function deletePublication({ id, actor }) {
  const idx = db.publications.findIndex((p) => p.id === id);
  if (idx === -1) throw httpError(404, 'Publication not found');
  const [pub] = db.publications.splice(idx, 1);
  recordAudit(actor, 'delete_paper', `${pub.title} (${pub.doi})`);
  schedulePersist();
  return { ok: true };
}

// --- researcher-submitted papers + revisions (Track 3 ↔ Track 4) -----------

// A logged-in researcher submits a paper straight into the editor pipeline.
export function submitToJournal({ userId, title, category, abstract, pdfUrl, coAuthors }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  if (!title?.trim() || !abstract?.trim() || !pdfUrl?.trim())
    throw httpError(400, 'Title, abstract, and paper link are required');
  const safePdf = safeUrl(pdfUrl, 500);
  if (!safePdf) throw httpError(400, 'The paper link must be a valid http(s) URL');
  if (!CATEGORIES.includes(category)) throw httpError(400, 'Pick a valid subject category');
  // @username co-author tags must resolve to real members (typos fail loudly).
  const coAuthorIds = [];
  for (const m of String(coAuthors || '').match(/@[\w.-]+/g) || []) {
    const co = getUserByUsername(m);
    if (!co) throw httpError(400, `No member with the username ${m} — check the spelling`);
    if (co.id !== userId && !coAuthorIds.includes(co.id)) coAuthorIds.push(co.id);
  }
  // A researcher who submits research is, at minimum, an independent researcher.
  if (!u.tags.includes('independent_researcher')) u.tags.push('independent_researcher');
  const at = now();
  const sub = {
    id: uid('paper'),
    title: title.trim(),
    authorName: u.name,
    authorEmail: u.email,
    authorDiscord: u.discord || '',
    submittedBy: userId,
    coAuthorIds,
    category,
    abstract: abstract.trim(),
    pdfUrl: safePdf,
    submittedAt: at,
    stage: STAGE.REVIEW,
    assignedReviewers: pickReviewers(category),
    assignee: null,
    reviews: [],
    comments: [],
    revisions: [{ version: 1, url: pdfUrl.trim(), note: coAuthors ? `Co-authors: ${coAuthors}` : 'Initial submission', at, byName: u.name }],
    revisionRequested: false,
    associateRounds: 0,
    history: [],
  };
  db.submissions.push(sub);
  notifyEvent({ title: 'New journal submission', body: `${u.name}: ${sub.title} (${category})` });
  schedulePersist();
  return decorate(sub);
}

// Papers a researcher has submitted (with status, for their dashboard).
export function mySubmissions(userId) {
  return db.submissions.filter((s) => s.submittedBy === userId).map(decorate);
}

// The submitter uploads a new version of their paper.
export function addRevision({ paperId, userId, url, note }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  if (sub.submittedBy !== userId) throw httpError(403, 'Only the submitter can revise this paper');
  if (!url?.trim()) throw httpError(400, 'A link to the revised paper is required');
  const safeRevision = safeUrl(url, 500);
  if (!safeRevision) throw httpError(400, 'The revised paper link must be a valid http(s) URL');
  sub.revisions = sub.revisions || [];
  const version = sub.revisions.length + 1;
  sub.revisions.push({ version, url: safeRevision, note: note || '', at: now(), byName: getResearcherById(userId)?.name });
  sub.pdfUrl = safeRevision;
  sub.revisionRequested = false;
  log(sub, { type: 'revision', version });
  if (sub.assignee) pushNotif(sub.assignee, { type: 'paper', title: 'Revised paper submitted', body: `"${sub.title}" — v${version}`, link: '/editor' });
  notifyReviewers(sub, 'A paper you reviewed was revised', `"${sub.title}" — v${version}`);
  notifyEvent({ title: 'Revision submitted', body: `${sub.title} — v${version}` });
  schedulePersist();
  return decorate(sub);
}

// An editor asks the author for a revision.
export function requestRevision({ paperId, editorId, note }) {
  const sub = getSub(paperId);
  if (!sub) throw httpError(404, 'Paper not found');
  const e = getEditorById(editorId);
  sub.revisionRequested = true;
  sub.comments = sub.comments || [];
  sub.comments.push({ id: `cmt_${Date.now()}`, authorId: editorId, authorName: e?.name || 'Editor', role: e?.role || null, body: `Revision requested: ${note || 'please submit a revised version.'}`, at: now() });
  log(sub, { type: 'revision_requested', editorId });
  pushNotif(sub.submittedBy, { type: 'revision', title: 'Revision requested', body: `"${sub.title}" — ${note || 'please revise'}`, link: '/researcher/journal' });
  notifyEvent({ title: 'Revision requested', body: `${sub.title}` });
  sendEmail({
    to: sub.authorEmail,
    subject: `Revision requested: ${sub.title}`,
    text: `Hi ${sub.authorName || 'researcher'},\n\nAn editor has requested a revision of "${sub.title}".\n\nNote: ${note || 'Please submit a revised version.'}\n\nUpload your revised version from your Synthica dashboard.\n\n— The Synthica editorial team`,
  });
  schedulePersist();
  return decorate(sub);
}

// --- internal transition helpers ------------------------------------------

function advance(sub, nextStage, note) {
  sub.stage = nextStage;
  // The next stage's single owner (senior/associate/chief). Reviews & published
  // don't take a single assignee here.
  if (nextStage === STAGE.SENIOR_SCREEN || nextStage === STAGE.SENIOR_FINAL) {
    sub.assignee = pickOne(EDITOR_ROLES.SENIOR, sub.category);
  } else if (nextStage === STAGE.ASSOCIATE) {
    sub.assignee = pickOne(EDITOR_ROLES.ASSOCIATE, sub.category);
  } else if (nextStage === STAGE.CHIEF || nextStage === STAGE.PUBLISHED) {
    sub.assignee = null;
  }
  log(sub, { type: 'advance', to: nextStage, notifyDirector: true, label: note.label, decision: note.decision });
  // Reaching STAGE.PUBLISHED here means the Chief approved — the paper is
  // ACCEPTED and now waits on the Director's desk. It only enters the Archive
  // once the Director mints a DOI in publishToJournal(), which sends the final
  // "now published" announcement. Keep this step to an acceptance notice.
  const accepted = nextStage === STAGE.PUBLISHED;
  // Followers see the author's paper move to a later round of publishing.
  const ROUND_NAME = {
    [STAGE.SENIOR_SCREEN]: 'senior editor screening',
    [STAGE.ASSOCIATE]: 'associate editor revisions',
    [STAGE.SENIOR_FINAL]: 'senior editor final review',
    [STAGE.CHIEF]: 'editor-in-chief review',
    [STAGE.PUBLISHED]: 'publication',
  };
  if (sub.submittedBy) {
    recordActivity(
      sub.submittedBy,
      'paper_advance',
      `advanced their paper “${sub.title}” to ${ROUND_NAME[nextStage] || 'the next round'}`,
      `/p/${getUserById(sub.submittedBy)?.slug || sub.submittedBy}`,
    );
  }
  notifyMove({
    title: sub.title,
    paperId: sub.id,
    category: sub.category,
    label: note.label,
    decision: 'approved',
  });
  if (accepted) {
    emailDecision({ authorEmail: sub.authorEmail, authorName: sub.authorName, title: sub.title, decision: 'published' });
    notifyReviewers(sub, 'A paper you reviewed was approved for publication', `"${sub.title}" · by ${sub.authorName}`);
  } else {
    notifyReviewers(sub, 'A paper you reviewed moved forward', `"${sub.title}" → ${note.label}`);
  }
}

function reject(sub, reachedLabel) {
  sub.stage = STAGE.REJECTED;
  sub.assignee = null;
  log(sub, { type: 'reject', notifyDirector: true, label: reachedLabel, decision: 'declined' });
  notifyMove({ title: sub.title, paperId: sub.id, category: sub.category, label: reachedLabel, decision: 'declined' });
  emailDecision({ authorEmail: sub.authorEmail, authorName: sub.authorName, title: sub.title, decision: 'declined' });
  notifyReviewers(sub, 'A paper you reviewed was declined', `"${sub.title}"`);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// --- plain getters for Track 2 + Track 4 -----------------------------------

// Legacy publications (and editorial/archive ones) are verified by default;
// only self-archived past papers start unverified until an auditor confirms.
const isVerifiedPub = (p) => p.verified !== false;

// Public listing shows verified papers only (unverified self-archives stay on
// the author's profile until reviewed).
export const listPublications = () => db.publications.filter(isVerifiedPub);
export const getPublication = (id) => db.publications.find((p) => p.id === id || p.doi === id) || null;

// --- journal home + volumes/issues (Phase 2) -------------------------------

const pubCard = (p) => ({
  id: p.id, doi: p.doi, title: p.title, category: p.category, articleType: p.articleType || 'Article',
  abstract: p.abstract || '', authors: (p.authors || []).map((a) => a.name), publishedAt: p.publishedAt,
  volume: p.volume, issue: p.issue, pages: p.pages, openAccess: p.openAccess !== false,
  featured: p.featured === true, accesses: p.metrics?.accesses || 0,
});

// Everything the Journal landing page needs in one call.
export function journalOverview() {
  const pubs = listPublications().slice().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const featured = pubs.find((p) => p.featured) || pubs[0] || null;
  const byVolume = new Map();
  const bySubject = new Map();
  for (const p of pubs) {
    const v = p.volume || 1, i = p.issue || 1;
    if (!byVolume.has(v)) byVolume.set(v, new Map());
    byVolume.get(v).set(i, (byVolume.get(v).get(i) || 0) + 1);
    if (p.category) bySubject.set(p.category, (bySubject.get(p.category) || 0) + 1);
  }
  const volumes = [...byVolume.entries()]
    .map(([volume, issues]) => ({ volume, issues: [...issues.entries()].map(([issue, count]) => ({ issue, count })).sort((a, b) => b.issue - a.issue) }))
    .sort((a, b) => b.volume - a.volume);
  // The newest issue = highest volume, highest issue.
  const latestVol = volumes[0];
  const latestIssue = latestVol ? { volume: latestVol.volume, issue: latestVol.issues[0]?.issue || 1 } : null;
  const currentIssue = latestIssue
    ? pubs.filter((p) => (p.volume || 1) === latestIssue.volume && (p.issue || 1) === latestIssue.issue).map(pubCard)
    : [];
  return {
    featured: featured ? pubCard(featured) : null,
    recent: pubs.slice(0, 6).map(pubCard),
    mostRead: [...pubs].sort((a, b) => (b.metrics?.accesses || 0) - (a.metrics?.accesses || 0)).slice(0, 5).map(pubCard),
    currentIssue, latestIssue,
    volumes,
    subjects: [...bySubject.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    stats: { papers: pubs.length, volumes: volumes.length, subjects: bySubject.size },
  };
}

export function listVolumes() {
  return journalOverview().volumes;
}

// All articles in one issue, as a table of contents (grouped, ordered by pages).
export function issueContents(volume, issue) {
  const v = Number(volume), i = Number(issue);
  const articles = listPublications()
    .filter((p) => (p.volume || 1) === v && (p.issue || 1) === i)
    .sort((a, b) => String(a.pages || '').localeCompare(String(b.pages || ''), undefined, { numeric: true }))
    .map(pubCard);
  return { volume: v, issue: i, count: articles.length, articles };
}

// --- journal issue lifecycle (first-class volume/issue records) -------------
// db.journalIssues = [{ volume, issue, status: 'open'|'closed', year,
// publishedAt, editorial }]. Exactly ONE issue is open at any time — it is the
// issue publishToJournal() assigns new papers to. Closing it stamps its
// publishedAt and opens the next (issue+1 within the same calendar year, a new
// volume once the year rolls over).

// The volume/issue that follows `rec` in `year` (UTC calendar year): the issue
// number increments within the year the record was opened in; the first issue
// opened in a later year starts a new volume at Issue 1.
const nextIssueNumber = (rec, year) =>
  !rec ? { volume: 1, issue: 1 }
  : (rec.year || year) === year ? { volume: rec.volume, issue: rec.issue + 1 }
  : { volume: rec.volume + 1, issue: 1 };

// Make sure the collection exists and holds exactly one open issue (creates
// Vol 1, Issue 1 lazily on an empty database, or continues after the newest
// closed issue if a provider snapshot lost the open one).
function ensureJournalIssues() {
  if (!Array.isArray(db.journalIssues)) db.journalIssues = [];
  if (!db.journalIssues.some((x) => x.status === 'open')) {
    const latest = [...db.journalIssues].sort((a, b) => a.volume - b.volume || a.issue - b.issue).pop();
    const year = new Date().getUTCFullYear();
    db.journalIssues.push({ ...nextIssueNumber(latest, year), status: 'open', year, publishedAt: null, editorial: '' });
  }
  return db.journalIssues;
}

// The issue new publications land in (always exists).
export function openJournalIssue() {
  return ensureJournalIssues().find((x) => x.status === 'open');
}

// Raw issue record, or null (used by routes to 404 on unknown volume/issue).
export function getJournalIssue(volume, issue) {
  const v = Number(volume), i = Number(issue);
  return ensureJournalIssues().find((x) => x.volume === v && x.issue === i) || null;
}

// Article tallies per "volume:issue", computed in one pass over the archive so
// listing N issues doesn't rescan the publications N times.
function articleCounts() {
  const counts = new Map();
  for (const p of listPublications()) {
    const key = `${p.volume || 1}:${p.issue || 1}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Public shape for one issue row (article counts come from the publications).
const issueRow = (x, counts = articleCounts()) => ({
  volume: x.volume,
  issue: x.issue,
  status: x.status,
  publishedAt: x.publishedAt || null,
  articleCount: counts.get(`${x.volume}:${x.issue}`) || 0,
  editorial: x.editorial || '',
});

// Every issue, newest first — the journal site's archive index.
export function listJournalIssues() {
  const counts = articleCounts();
  return ensureJournalIssues()
    .slice()
    .sort((a, b) => b.volume - a.volume || b.issue - a.issue)
    .map((x) => issueRow(x, counts));
}

// One issue + its full table of contents (reuses issueContents for the cards).
export function journalIssueDetail(volume, issue) {
  const rec = getJournalIssue(volume, issue);
  if (!rec) return null;
  return {
    volume: rec.volume,
    issue: rec.issue,
    status: rec.status,
    publishedAt: rec.publishedAt || null,
    editorial: rec.editorial || '',
    articles: issueContents(rec.volume, rec.issue).articles,
  };
}

// Journal-level metadata (ISSN etc.) the public journal site + indexers read.
// ISSN/journal-URL resolution is shared with doi.js so citations, Crossref
// deposits, and this masthead can never disagree.
export function journalMeta() {
  const open = openJournalIssue();
  return {
    title: 'Synthica Journal',
    issn: journalIssn() || 'pending',
    publisher: 'Synthica',
    frequency: 'Quarterly',
    journalUrl: journalUrl(),
    dashboardUrl: (process.env.FRONTEND_URL || 'https://app.synthica.org').replace(/\/$/, ''),
    currentVolume: open.volume,
    currentIssue: open.issue,
  };
}

// Director closes the open issue: stamp its publication date and open the next
// one. Rule: issue numbers increment within a calendar year; the first issue
// opened in a new year starts a new volume at Issue 1. `at` (ISO date) lets the
// Director backdate the close; it defaults to now and also decides "what year
// is it" for the volume rollover.
export function closeOpenIssue({ editorial, at } = {}) {
  const open = openJournalIssue();
  const when = at ? new Date(at) : new Date();
  if (Number.isNaN(when.getTime())) throw httpError(400, 'Invalid close date');
  open.status = 'closed';
  open.publishedAt = when.toISOString().slice(0, 10);
  if (editorial !== undefined) open.editorial = String(editorial || '').slice(0, 2000);
  // UTC year, so the rollover agrees with the UTC publishedAt stamp above.
  const year = when.getUTCFullYear();
  const next = nextIssueNumber(open, year);
  db.journalIssues.push({ ...next, status: 'open', year, publishedAt: null, editorial: '' });
  recordAudit({ name: 'Director' }, 'close_issue', `Closed Vol. ${open.volume} Issue ${open.issue}; opened Vol. ${next.volume} Issue ${next.issue}`);
  schedulePersist();
  const counts = articleCounts();
  return { closed: issueRow(open, counts), opened: issueRow(openJournalIssue(), counts) };
}

// Director moves a published article into another (existing) issue — e.g. to
// pull a paper forward into the open issue or fix a mis-filed one.
export function moveArticleToIssue({ publicationId, volume, issue }) {
  const pub = getPublication(publicationId);
  if (!pub) throw httpError(404, 'Publication not found');
  const target = getJournalIssue(volume, issue);
  if (!target) throw httpError(404, `No such issue: Vol. ${volume} Issue ${issue}`);
  pub.volume = target.volume;
  pub.issue = target.issue;
  recordAudit({ name: 'Director' }, 'move_article', `"${pub.title}" (${pub.doi}) → Vol. ${target.volume} Issue ${target.issue}`);
  schedulePersist();
  return pub;
}

// --- preprint server (Phase 3) ---------------------------------------------
// Author-posted, not peer-reviewed, versioned, citable instantly with an internal
// Synthica ID (SYN-YYYY-NNNN). No DOI until/unless it's published in the journal.

// Mint a sequential per-year preprint accession number.
function mintSynId() {
  if (!Array.isArray(db.preprints)) db.preprints = [];
  const year = new Date().getFullYear();
  const n = db.preprints.filter((p) => (p.synId || '').includes(`-${year}-`)).length + 1;
  return `SYN-${year}-${String(n).padStart(4, '0')}`;
}

const getPreprint = (id) => (db.preprints || []).find((p) => p.id === id || p.synId === id) || null;
const canEditPreprint = (actor, pp) => !!actor && (isStaff(actor) || pp.authorUserId === actor.id || (pp.authorUserIds || []).includes(actor.id));

const preprintCard = (pp) => ({
  id: pp.id, synId: pp.synId, title: pp.title, category: pp.category, abstract: pp.abstract || '',
  authors: pp.authors || [], postedAt: pp.postedAt, version: (pp.versions || []).length || 1,
  linkedDoi: pp.linkedDoi || null, accesses: pp.accesses || 0,
});

export function postPreprint({ userId, title, category, abstract, pdfUrl, coAuthorIds }) {
  const u = getResearcherById(userId) || getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (u.approved === false) throw httpError(403, 'Your account is pending approval');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  if (!Array.isArray(db.preprints)) db.preprints = [];
  const at = now();
  const safePdf = safeUrl(pdfUrl, 400);
  const authorUserIds = [...new Set([userId, ...(Array.isArray(coAuthorIds) ? coAuthorIds : [])])].filter((id) => getUserById(id));
  const pp = {
    id: uid('pre'),
    synId: mintSynId(),
    title: title.trim().slice(0, 300),
    category: CATEGORIES.includes(category) ? category : (category || ''),
    abstract: String(abstract || '').trim().slice(0, 4000),
    authors: authorUserIds.map((id) => ({ name: getUserById(id)?.name || 'Member', userId: id })),
    authorUserId: userId,
    authorUserIds,
    taggedUserIds: [],
    versions: [{ v: 1, pdfUrl: safePdf, postedAt: at, note: 'Initial version' }],
    linkedDoi: null,
    postedAt: at,
    accesses: 0,
  };
  db.preprints.unshift(pp);
  recordActivity(userId, 'preprint_posted', `posted the preprint "${pp.title}"`, `/preprints/${pp.id}`);
  schedulePersist();
  return preprintView(pp.id, userId);
}

export function addPreprintVersion({ preprintId, userId, pdfUrl, note }) {
  const pp = getPreprint(preprintId);
  if (!pp) throw httpError(404, 'Preprint not found');
  if (!canEditPreprint(getUserById(userId), pp)) throw httpError(403, 'Only an author or staff can post a new version');
  pp.versions = pp.versions || [];
  pp.versions.push({ v: pp.versions.length + 1, pdfUrl: safeUrl(pdfUrl, 400), postedAt: now(), note: String(note || '').slice(0, 200) });
  schedulePersist();
  return preprintView(pp.id, userId);
}

export function listPreprints({ category, q } = {}) {
  let list = [...(db.preprints || [])].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  if (category) list = list.filter((p) => p.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((p) => p.title.toLowerCase().includes(needle) || (p.authors || []).some((a) => a.name.toLowerCase().includes(needle)));
  }
  return list.map(preprintCard);
}

export const myPreprints = (userId) =>
  (db.preprints || [])
    .filter((p) => p.authorUserId === userId || (p.authorUserIds || []).includes(userId) || (p.taggedUserIds || []).includes(userId))
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
    .map(preprintCard);

// Full preprint payload for its hero page (mirrors articleView).
export function preprintView(idOrSyn, viewerId) {
  const pp = getPreprint(idOrSyn);
  if (!pp) return null;
  const viewer = viewerId ? getUserById(viewerId) : null;
  const authors = (pp.authors || []).map((a) => ({ name: a.name, account: a.userId ? accountCard(a.userId) : null }));
  const taggedAccounts = [...new Set(pp.taggedUserIds || [])].map(accountCard).filter(Boolean);
  const related = (db.preprints || [])
    .filter((p) => p.id !== pp.id && p.category === pp.category)
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
    .slice(0, 4)
    .map((p) => ({ id: p.id, synId: p.synId, title: p.title, category: p.category, postedAt: p.postedAt }));
  const versions = [...(pp.versions || [])].sort((a, b) => b.v - a.v);
  return {
    id: pp.id, synId: pp.synId, title: pp.title, category: pp.category, abstract: pp.abstract,
    authors, taggedAccounts, versions, linkedDoi: pp.linkedDoi || null, linkedPubId: pp.linkedPubId || null,
    postedAt: pp.postedAt, latestPdf: versions[0]?.pdfUrl || '', accesses: pp.accesses || 0, related,
    canEdit: canEditPreprint(viewer, pp), canTag: canEditPreprint(viewer, pp),
  };
}

// --- preprint ⇄ journal cross-linking (Phase 4) ----------------------------

const normTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Low-level link: stamp the DOI onto the preprint and the preprint id onto the pub.
function linkPreprintPub(pp, pub) {
  pp.linkedDoi = pub.doi;
  pp.linkedPubId = pub.id;
  pub.preprintId = pp.id;
  pub.hasPreprint = true;
}

// On publish, auto-link a preprint that shares an author and the same (normalized)
// title — but only when the match is unambiguous (exactly one).
function autoLinkPreprintForPublication(pub) {
  const authorIds = new Set([pub.authorUserId, ...(pub.authorUserIds || [])].filter(Boolean));
  const target = normTitle(pub.title);
  if (!target) return;
  const matches = (db.preprints || []).filter((pp) =>
    !pp.linkedDoi && normTitle(pp.title) === target &&
    (authorIds.has(pp.authorUserId) || (pp.authorUserIds || []).some((id) => authorIds.has(id))));
  if (matches.length === 1) linkPreprintPub(matches[0], pub);
}

// Manual link: an author of either side, or staff, ties a preprint to a publication.
export function linkPreprintToPublication({ preprintId, pubId, actorId }) {
  const pp = getPreprint(preprintId);
  const pub = getPublication(pubId);
  if (!pp || !pub) throw httpError(404, 'Preprint or publication not found');
  const actor = getUserById(actorId);
  const mayLink = isStaff(actor) || canEditPreprint(actor, pp) || canTagPublication(actor, pub);
  if (!mayLink) throw httpError(403, 'Only an author or staff can link these');
  linkPreprintPub(pp, pub);
  recordAudit(actor, 'link_preprint', `${pp.synId} → ${pub.doi}`);
  schedulePersist();
  return articleView(pub.id, actorId);
}

export function recordPreprintAccess(idOrSyn) {
  const pp = getPreprint(idOrSyn);
  if (!pp) return null;
  pp.accesses = (pp.accesses || 0) + 1;
  schedulePersist();
  return pp.accesses;
}

// Tag (credit) Synthica accounts on a preprint.
export function tagPreprintAccounts({ preprintId, actorId, addUserIds = [], removeUserIds = [] }) {
  const pp = getPreprint(preprintId);
  if (!pp) throw httpError(404, 'Preprint not found');
  if (!canEditPreprint(getUserById(actorId), pp)) throw httpError(403, 'Only an author or staff can tag accounts');
  if (!Array.isArray(pp.taggedUserIds)) pp.taggedUserIds = [];
  for (const uid of Array.isArray(addUserIds) ? addUserIds : []) {
    if (uid && getUserById(uid) && !pp.taggedUserIds.includes(uid)) {
      pp.taggedUserIds.push(uid);
      if (uid !== actorId) pushNotif(uid, { type: 'paper', title: 'You were tagged on a preprint', body: pp.title, link: `/preprints/${pp.id}` });
    }
  }
  const remove = new Set(Array.isArray(removeUserIds) ? removeUserIds : []);
  pp.taggedUserIds = pp.taggedUserIds.filter((uid) => !remove.has(uid)).slice(0, 30);
  schedulePersist();
  return preprintView(pp.id, actorId);
}


// --- article page (Nature-style hero) + account tagging --------------------

// A compact public card for a tagged/linked Synthica account.
function accountCard(userId) {
  const u = getUserById(userId);
  if (!u) return null;
  return { id: u.id, name: u.name, slug: u.slug || u.id, avatarUrl: u.avatarUrl || '', role: roleDisplay(u) };
}

// Who may tag accounts on a paper: staff, or one of its linked authors.
const canTagPublication = (actor, pub) =>
  !!actor && (isStaff(actor) || pub.authorUserId === actor.id || (pub.authorUserIds || []).includes(actor.id));

// Full article payload for the hero page: the publication plus resolved author
// + tagged-account cards, a "can I tag" flag, and a few related papers.
export function articleView(idOrDoi, viewerId) {
  const pub = getPublication(idOrDoi);
  if (!pub || pub.verified === false) return null;
  const viewer = viewerId ? getUserById(viewerId) : null;
  // Authors that map to a real account become profile links.
  const authors = (pub.authors || []).map((a) => {
    const uid = a.userId || (pub.authors.length === 1 ? pub.authorUserId : null);
    const card = uid ? accountCard(uid) : null;
    return { name: a.name, affiliation: a.affiliation || '', account: card };
  });
  const taggedAccounts = [...new Set(pub.taggedUserIds || [])].map(accountCard).filter(Boolean);
  const related = db.publications
    .filter((p) => isVerifiedPub(p) && p.id !== pub.id && p.category === pub.category)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 4)
    .map((p) => ({ id: p.id, doi: p.doi, title: p.title, category: p.category, articleType: p.articleType, publishedAt: p.publishedAt }));
  const linkedPre = pub.preprintId ? getPreprint(pub.preprintId) : null;
  const preprint = linkedPre ? { id: linkedPre.id, synId: linkedPre.synId, version: (linkedPre.versions || []).length || 1 } : null;
  return { ...pub, authors, taggedAccounts, related, preprint, canTag: canTagPublication(viewer, pub) };
}

// Tag (credit/link) Synthica accounts on a publication so it surfaces on their
// profiles + dashboards. Authors of the paper or staff can manage tags.
export function tagPublicationAccounts({ pubId, actorId, addUserIds = [], removeUserIds = [] }) {
  const pub = getPublication(pubId);
  if (!pub) throw httpError(404, 'Publication not found');
  const actor = getUserById(actorId);
  if (!canTagPublication(actor, pub)) throw httpError(403, 'Only an author or staff can tag accounts on this paper');
  if (!Array.isArray(pub.taggedUserIds)) pub.taggedUserIds = [];
  for (const uid of Array.isArray(addUserIds) ? addUserIds : []) {
    if (uid && getUserById(uid) && !pub.taggedUserIds.includes(uid)) {
      pub.taggedUserIds.push(uid);
      if (uid !== actorId) pushNotif(uid, { type: 'paper', title: 'You were tagged on a paper', body: pub.title, link: `/article/${pub.id}` });
    }
  }
  const remove = new Set(Array.isArray(removeUserIds) ? removeUserIds : []);
  pub.taggedUserIds = pub.taggedUserIds.filter((uid) => !remove.has(uid)).slice(0, 30);
  recordAudit(actor, 'tag_paper_accounts', `${pub.title} (${pub.taggedUserIds.length} tagged)`);
  schedulePersist();
  return articleView(pub.id, actorId);
}

// Admin/auditor views: the full set, plus the pending self-archive queue.
export const adminListPublications = () => [...db.publications].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
export const listArchiveQueue = () => db.publications.filter((p) => p.source === 'self' && p.verified === false);
export const myPublications = (userId) =>
  db.publications
    .filter((p) => p.authorUserId === userId || (p.authorUserIds || []).includes(userId) || (p.taggedUserIds || []).includes(userId))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
export const listProjects = () => db.projects;
export const getProject = (id) => db.projects.find((p) => p.id === id) || null;
// Listings enriched with the people already on board (lead + accepted
// applicants) so cards can show pfp circles and a filled/wanted count.
export const listListings = () =>
  db.listings.map((l) => {
    const memberIds = [l.leadId, ...db.applications.filter((a) => a.listingId === l.id && a.status === 'approved').map((a) => a.userId)].filter(Boolean);
    const team = [...new Set(memberIds)]
      .map((id) => getUserById(id))
      .filter(Boolean)
      .map((u) => ({ id: u.id, slug: u.slug || u.id, name: u.name, avatarUrl: u.avatarUrl || '' }));
    return { ...l, team, filled: team.length };
  });
export const listApplications = () => db.applications;

// Suggest a starting role for a new member from their self-rated onboarding
// signals, so auditors get a sensible default instead of guessing.
// Score the written experience/publications description against known
// milestones (first match wins, strongest first). Deterministic stand-in for
// the "light LLM" idea — same contract, no API key needed.
export function suggestResearchScore(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const rules = [
    [10, /\brsi\b|research science institute/i, 'RSI'],
    [10, /\bisef\b.{0,30}\b(grand|won|winner|1st|first)\b|\b(won|winner|1st|first)\b.{0,30}\bisef\b/i, 'winning ISEF'],
    [9, /\b(published|publication|peer[- ]?review(ed)?|journal|arxiv|preprint|doi)\b/i, 'a publication'],
    [8, /\bisef\b/i, 'ISEF'],
    [8, /\b(summer science program|ssp\b|simons|promys|mathcamp|sumac)\b/i, 'a selective summer program'],
    [7, /\bstate\b.{0,25}\b(fair|finals?|level|champion)/i, 'a state-level fair'],
    [6, /\b(research internship|research lab|lab experience|university research)\b/i, 'lab or internship research'],
    [5, /\b(regional|county)\b.{0,25}\b(fair|award|medal|place)/i, 'a regional fair'],
    [4, /\bscience fair\b/i, 'a science fair'],
    [2, /\b(school|class)\b.{0,25}\b(project|lab)/i, 'school projects'],
  ];
  for (const [score, re, evidence] of rules) if (re.test(t)) return { score, evidence };
  return { score: 3, evidence: 'self-described experience' };
}

export function recommendRole(u) {
  const slider = Number(u?.researchExperience) || 0;
  const text = suggestResearchScore(u?.experienceSummary);
  // Written evidence can raise (never lower) the self-rated score.
  const r = Math.max(slider, text?.score || 0);
  const via = text && text.score >= slider ? ` — mentions ${text.evidence}` : '';
  const l = Number(u?.leadershipExperience) || 0;
  if (u?.priorLead && u?.legacyProject?.title)
    return { tag: 'lead_researcher', label: 'Lead Researcher', reason: `Led “${u.legacyProject.title}” in the old system — verify and restore.` };
  if (u?.wantsChapterLead && l >= 6)
    return { tag: 'chapter_leader', label: 'Chapter Leader', reason: `Wants to lead a chapter and rates leadership ${l}/10.` };
  if (r >= 8)
    return { tag: 'lead_researcher', label: 'Lead Researcher', reason: `Strong research track record (${r}/10${via || ' — ISEF/RSI tier'}). Can lead projects.` };
  if (l >= 6)
    return { tag: 'chapter_leader', label: 'Chapter Leader', reason: `High leadership experience (${l}/10) — good fit to run a chapter.` };
  if (r >= 4)
    return { tag: 'associate_researcher', label: 'Associate Researcher', reason: `Some research experience (${r}/10${via}). Ready to join a team.` };
  return { tag: 'independent_researcher', label: 'Independent Researcher', reason: 'New to research — start independent and grow.' };
}

// Admin/auditor view: onboarding rows are enriched with the applicant's signals
// + a recommended role.
export const allApplications = () =>
  db.applications.map((a) => {
    if (a.kind !== 'onboarding') return a;
    const u = getResearcherById(a.userId);
    if (!u) return a;
    return {
      ...a,
      researchExperience: u.researchExperience ?? null,
      leadershipExperience: u.leadershipExperience ?? null,
      wantsChapterLead: !!u.wantsChapterLead,
      gpa: u.gpa || '',
      resumeUrl: u.resumeUrl || a.resumeUrl || '',
      experienceSummary: u.experienceSummary || '',
      priorLead: !!u.priorLead,
      legacyProject: u.legacyProject || null,
      recommendation: recommendRole(u),
    };
  })
  // Independent project proposals join the same queue so the Moderator console
  // can review them alongside membership/role applications.
  .concat(listProposals());

// --- independent research proposals (Track 4) ------------------------------
// Independent Researchers submit a research proposal (title, category,
// description, methodology). It sits in a pending queue a Moderator reviews:
// on approve a real project is created and handed to the member; on reject the
// member gets feedback and can revise & resubmit. Modeled like applications
// (id/userId/userName/status/at) so the Moderator console can surface them.

const PROPOSAL_TAG = 'independent_researcher';

// Shape a proposal as an application-style row (kind: 'proposal') so existing
// admin/moderator queues can render + review it with the same controls.
function proposalRow(p) {
  return { ...p, kind: 'proposal' };
}

const proposals = () => db.proposals || (db.proposals = []);
export const listProposals = () => proposals().map(proposalRow);
export const listProposalsForUser = (userId) =>
  proposals().filter((p) => p.userId === userId).map(proposalRow);
export const getProposal = (id) => proposals().find((p) => p.id === id) || null;

// Member submits a research proposal. Independent Researchers only — others
// create projects directly (leads) or join teams (associates).
export function addProposal({ userId, title, category, description, methodology }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  if (!Array.isArray(u.tags) || !u.tags.includes(PROPOSAL_TAG))
    throw httpError(403, 'Only Independent Researchers can submit project proposals');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  const record = {
    id: uid('prop'),
    userId,
    userName: u.name,
    title: title.trim().slice(0, 140),
    category: category || '',
    description: (description || '').trim().slice(0, 2000),
    methodology: (methodology || '').trim().slice(0, 2000),
    status: 'pending',
    feedback: '',
    projectId: null,
    at: now(),
    reviewedBy: null,
    reviewedAt: null,
  };
  proposals().push(record);
  recordAudit({ id: userId, name: u.name }, 'submit_proposal', record.title);
  notifyEvent({ title: 'New research proposal', body: `${u.name} proposed "${record.title}".` });
  schedulePersist();
  return proposalRow(record);
}

// Member revises a rejected proposal and resubmits it (back to pending).
export function reviseProposal({ id, userId, title, category, description, methodology }) {
  const p = getProposal(id);
  if (!p) throw httpError(404, 'Proposal not found');
  if (p.userId !== userId) throw httpError(403, 'Not your proposal');
  if (p.status === 'approved') throw httpError(400, 'An approved proposal can’t be edited');
  if (typeof title === 'string' && title.trim()) p.title = title.trim().slice(0, 140);
  if (typeof category === 'string' && category) p.category = category;
  if (typeof description === 'string') p.description = description.trim().slice(0, 2000);
  if (typeof methodology === 'string') p.methodology = methodology.trim().slice(0, 2000);
  p.status = 'pending';
  p.reviewedBy = null;
  p.reviewedAt = null;
  notifyEvent({ title: 'Proposal resubmitted', body: `${p.userName} revised "${p.title}".` });
  schedulePersist();
  return proposalRow(p);
}

// Moderator reviews a proposal. On approve a real project is created (the member
// is the lead/owner) and they can begin work; on reject they get feedback to
// revise & resubmit. Feedback is optional but surfaced to the member either way.
export function reviewProposal({ id, status, reviewerId, feedback }) {
  const p = getProposal(id);
  if (!p) throw httpError(404, 'Proposal not found');
  if (!['approved', 'rejected'].includes(status)) throw httpError(400, 'Invalid status');
  if (p.status === 'approved') throw httpError(400, 'This proposal was already approved');
  p.status = status;
  p.feedback = (feedback || '').trim();
  p.reviewedBy = reviewerId || null;
  p.reviewedAt = now();
  recordAudit({ id: reviewerId }, 'review_proposal', `${p.userName}: "${p.title}" -> ${status}`);

  if (status === 'approved') {
    // Create the project and hand it to the member so they can start working.
    const project = {
      id: uid('proj'), title: p.title, category: p.category || '',
      description: p.description || '', methodology: p.methodology || '',
      leadId: p.userId, members: [p.userId], origin: 'proposal', proposalId: p.id,
      announcements: [], tasks: [], links: [], ideas: [], roles: [], invites: [],
    };
    db.projects.push(project);
    p.projectId = project.id;
    recordActivity(p.userId, 'project_started', `started the project ${project.title}`, `/researcher/project/${project.id}`);
    pushNotif(p.userId, { type: 'project', title: 'Proposal approved — your project is live', body: project.title, link: `/researcher/project/${project.id}` });
  } else {
    pushNotif(p.userId, { type: 'application', title: 'Your project proposal needs revisions', body: p.feedback || p.title, link: '/researcher/independent' });
  }
  schedulePersist();
  return proposalRow(p);
}

const ROLE_TO_TAG = {
  'Lead Researcher': 'lead_researcher',
  'Associate Researcher': 'associate_researcher',
  'Chapter Leader': 'chapter_leader',
  'Independent Researcher': 'independent_researcher',
};
const RESEARCHER_TAGS = new Set(Object.values(ROLE_TO_TAG));

// If this member claimed a project from the old system, becoming a Lead
// restores it (whichever path granted the tag).
function restoreLegacyProject(u, actorId) {
  if (!u?.legacyProject?.title) return;
  const lp = u.legacyProject;
  db.projects.push({
    id: uid('proj'), title: lp.title, category: lp.category || '', description: lp.description || '',
    leadId: u.id, members: [u.id], announcements: [], tasks: [], links: [], ideas: [], invites: [],
  });
  recordAudit({ id: actorId }, 'restore_project', `${lp.title} (for ${u.name})`);
  pushNotif(u.id, { type: 'project', title: 'Your project was restored', body: lp.title, link: '/researcher/projects' });
  u.legacyProject = null;
}

// Auditor/Director reviews an onboarding or role application. On approval they
// may assign a researcher tag directly (assignTag), otherwise the application's
// requested role maps to a tag.
export function setApplicationStatus({ id, status, reviewerId, assignTag, feedback }) {
  // Independent project proposals share the Moderator queue but follow their own
  // approve→create-project path, so delegate when the id is a proposal. Proposals
  // carry no role tag, so only `feedback` is forwarded (never `assignTag`).
  if (getProposal(id)) return reviewProposal({ id, status, reviewerId, feedback });
  const a = db.applications.find((x) => x.id === id);
  if (!a) throw httpError(404, 'Application not found');
  if (!['pending', 'approved', 'rejected'].includes(status)) throw httpError(400, 'Invalid status');
  a.status = status;
  a.reviewedBy = reviewerId || null;
  a.reviewedAt = now();
  recordAudit({ id: reviewerId }, 'review_application', `${a.userName}: ${a.role || a.kind || 'application'} -> ${status}`);
  pushNotif(a.userId, { type: 'application', title: `Your ${a.kind === 'onboarding' ? 'membership' : 'application'} was ${status}`, body: a.role || assignTag || '', link: '/researcher' });
  // Approving grants a researcher tag: the explicitly chosen one, or the one the
  // requested role maps to.
  if (status === 'approved') {
    const tag = (assignTag && RESEARCHER_TAGS.has(assignTag)) ? assignTag : (a.role && ROLE_TO_TAG[a.role]);
    const u = getResearcherById(a.userId);
    if (u) {
      // A decided application activates the member (role assigned -> can log in).
      u.approved = true;
      u.onboardingRejected = false;
      if (tag) {
        if (!Array.isArray(u.tags)) u.tags = [];
        if (!u.tags.includes(tag)) { u.tags.push(tag); recordRoleActivity(u.id, [tag]); }
        a.assignedTag = tag;
        // Approving a returning lead restores the project they claimed.
        if (tag === 'lead_researcher') restoreLegacyProject(u, reviewerId);
        // One-time in-app congrats + a welcome email with the assigned role.
        u.newRoleCongrats = TAG_LABEL[tag] || tag;
        if (u.email) {
          const site = (process.env.FRONTEND_URL || 'https://app.synthica.org').replace(/\/$/, '');
          actionEmail({
            to: u.email,
            subject: `You're approved — welcome as a ${TAG_LABEL[tag] || tag}!`,
            heading: `You're in — welcome aboard!`,
            intro: `Hi ${String(u.name || 'there').split(/\s+/)[0]},`,
            blocks: [
              `Congrats! Your membership was approved and you've been assigned the role of <strong>${TAG_LABEL[tag] || tag}</strong>.`,
              `Sign in to set up your profile, join a research group, and start exploring competitions and programs.`,
            ],
            button: { label: 'Open your dashboard', url: `${site}/researcher` },
          });
        }
      }
    }
  } else if (status === 'rejected' && a.kind === 'onboarding') {
    // Surface the decision on the member's pending screen instead of leaving
    // them waiting forever.
    const u = getResearcherById(a.userId);
    if (u) u.onboardingRejected = true;
  }
  schedulePersist();
  return a;
}

// Auditors assign/remove researcher tags directly (role assignment), without
// the editor-role powers reserved for the Director.
export function auditorSetTags({ userId, addTags, removeTags, actor }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  if (!Array.isArray(u.tags)) u.tags = [];
  const granted = (Array.isArray(addTags) ? addTags : []).filter((t) => RESEARCHER_TAGS.has(t) && !u.tags.includes(t));
  granted.forEach((t) => u.tags.push(t));
  recordRoleActivity(u.id, granted);
  (Array.isArray(removeTags) ? removeTags : []).forEach((t) => { u.tags = u.tags.filter((x) => x !== t); });
  if ((addTags || []).length) u.approved = true; // granting a role activates the member
  if (granted.includes('lead_researcher')) {
    restoreLegacyProject(u, actor?.id);
    u.leadRecommended = false; // clear the nudge once they've become a lead
  }
  if (granted.length) u.newRoleCongrats = TAG_LABEL[granted[granted.length - 1]] || granted[granted.length - 1];
  recordAudit(actor, 'assign_tags', `${u.name}: [${u.tags.join(',')}]`);
  schedulePersist();
  const { password, twoFactorSecret, ...safe } = u;
  return safe;
}

// Active journal submissions still in the editorial pipeline (not published to
// archive, not declined).
function pipelineSubmissions() {
  return db.submissions.filter((s) => !s.published && s.stage !== STAGE.REJECTED);
}

// Count a verified article view (journal archive + static article pages).
export function recordPublicationAccess(id) {
  const pub = db.publications.find((p) => p.id === id || p.doi === id);
  if (!pub || !isVerifiedPub(pub)) return null;
  if (!pub.metrics) pub.metrics = { accesses: 0, citations: 0, altmetric: 0 };
  pub.metrics.accesses = (pub.metrics.accesses || 0) + 1;
  schedulePersist();
  return pub.metrics.accesses;
}

// Platform analytics for the admin page.
export function analytics() {
  const active = pipelineSubmissions();
  const byStage = {};
  for (const s of active) byStage[s.stage] = (byStage[s.stage] || 0) + 1;
  const byCategory = {};
  for (const p of db.publications) if (isVerifiedPub(p)) byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  const pendingApplications = allApplications().filter((a) => a.status === 'pending').length;
  const pendingPapers = db.publications.filter((p) => p.source === 'self' && p.verified === false).length;
  return {
    users: db.editors.length + db.researchers.length,
    editors: db.editors.length,
    researchers: db.researchers.length,
    submissions: active.length,
    pipelineSubmissions: active.length,
    published: db.publications.filter(isVerifiedPub).length,
    byStage,
    byCategory,
    applications: db.applications.length,
    pendingApplications,
    pendingPapers,
    pendingReviews: pendingApplications + pendingPapers,
    chapters: db.chapters.length,
    projects: db.projects.length,
    totalAccesses: db.publications.filter(isVerifiedPub).reduce((s, p) => s + (p.metrics?.accesses || 0), 0),
  };
}

// Public impact counters for the marketing site (no auth, no PII).
export function publicStats() {
  return {
    researchers: db.researchers.length,
    members: db.editors.length + db.researchers.length,
    papersPublished: db.publications.filter((p) => p.verified !== false).length,
    projects: db.projects.length,
    chapters: db.chapters.length,
    openPrograms: db.programs.filter((p) => p.status === 'open').length,
  };
}

// --- programs (apply → cohort → milestones) ---------------------------------

const getProgram = (id) => db.programs.find((p) => p.id === id);

// Public view for the marketing site: open programs, no member identities.
export function listPublicPrograms() {
  return db.programs
    .filter((p) => p.status === 'open')
    .map((p) => ({
      id: p.id, title: p.title, cohortLabel: p.cohortLabel, category: p.category,
      description: p.description, spots: p.spots, applyDeadline: p.applyDeadline,
      startAt: p.startAt, endAt: p.endAt, cohortSize: p.cohort.length,
      milestones: p.milestones.map((m) => ({ id: m.id, title: m.title, dueAt: m.dueAt })),
    }));
}

// Researcher view: every non-archived program plus where this user stands.
export function listProgramsFor(userId) {
  return db.programs
    .filter((p) => p.status !== 'archived')
    .map((p) => {
      const application = db.applications.find(
        (a) => a.kind === 'program' && a.programId === p.id && a.userId === userId,
      );
      const myStatus = p.cohort.includes(userId)
        ? 'member'
        : application?.status === 'pending'
          ? 'applied'
          : application?.status === 'rejected'
            ? 'rejected'
            : 'none';
      return {
        id: p.id, title: p.title, cohortLabel: p.cohortLabel, category: p.category,
        description: p.description, spots: p.spots, applyDeadline: p.applyDeadline,
        startAt: p.startAt, endAt: p.endAt, status: p.status,
        cohortSize: p.cohort.length, milestones: p.milestones, myStatus,
      };
    });
}

export function applyToProgram({ programId, userId, message }) {
  const p = getProgram(programId);
  if (!p) throw httpError(404, 'Program not found');
  if (p.status !== 'open') throw httpError(400, 'This program is not accepting applications');
  if (p.applyDeadline && new Date(p.applyDeadline) < new Date()) throw httpError(400, 'The application deadline has passed');
  if (p.cohort.includes(userId)) throw httpError(400, "You're already in this cohort");
  if (p.spots && p.cohort.length >= p.spots) throw httpError(400, 'This cohort is full');
  if (db.applications.some((a) => a.kind === 'program' && a.programId === programId && a.userId === userId && a.status === 'pending'))
    throw httpError(400, "You've already applied — hang tight!");
  const u = getUserById(userId);
  const record = {
    id: `app_${db.applications.length + 1}`,
    kind: 'program',
    programId,
    userId,
    userName: u?.name || '',
    message: String(message || '').slice(0, 600),
    status: 'pending',
    at: now(),
  };
  db.applications.push(record);
  notifyEvent({ title: 'Program application', body: `${record.userName} applied to ${p.title}${p.cohortLabel ? ` (${p.cohortLabel})` : ''}.` });
  schedulePersist();
  return record;
}

// Admin view: all programs with cohort names + their pending applications.
export function listProgramsAdmin() {
  const nameOf = (id) => getUserById(id)?.name || id;
  return db.programs.map((p) => ({
    ...p,
    cohortMembers: p.cohort.map((id) => ({ id, name: nameOf(id) })),
    applications: db.applications
      .filter((a) => a.kind === 'program' && a.programId === p.id)
      .map((a) => ({ ...a })),
  }));
}

export function createProgram({ title, description, category, cohortLabel, spots, applyDeadline, startAt, endAt, milestones }, actor) {
  if (!title?.trim()) throw httpError(400, 'A title is required');
  const p = {
    id: `prg_${Date.now()}`,
    title: title.trim().slice(0, 140),
    cohortLabel: String(cohortLabel || '').trim().slice(0, 60),
    category: CATEGORIES.includes(category) ? category : '',
    description: String(description || '').slice(0, 1200),
    spots: Math.max(0, Number(spots) || 0),
    applyDeadline: applyDeadline || '',
    startAt: startAt || '',
    endAt: endAt || '',
    status: 'open',
    cohort: [],
    milestones: (Array.isArray(milestones) ? milestones : [])
      .filter((m) => m && m.title?.trim())
      .map((m, i) => ({ id: `ms_${i + 1}`, title: m.title.trim().slice(0, 140), dueAt: m.dueAt || '', done: false })),
    createdBy: actor?.id || 'system',
    createdAt: now(),
  };
  db.programs.push(p);
  recordAudit(actor, 'program.create', p.title);
  schedulePersist();
  return p;
}

export function updateProgramStatus({ programId, status, actor }) {
  const p = getProgram(programId);
  if (!p) throw httpError(404, 'Program not found');
  if (!['open', 'closed', 'archived'].includes(status)) throw httpError(400, 'Invalid status');
  p.status = status;
  recordAudit(actor, 'program.status', `${p.title} → ${status}`);
  schedulePersist();
  return p;
}

export function addProgramMilestone({ programId, title, dueAt, actor }) {
  const p = getProgram(programId);
  if (!p) throw httpError(404, 'Program not found');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  p.milestones.push({ id: `ms_${Date.now()}`, title: title.trim().slice(0, 140), dueAt: dueAt || '', done: false });
  schedulePersist();
  return p;
}

// Cohort-wide milestone toggle; members are notified when one completes.
export function toggleProgramMilestone({ programId, milestoneId, done, actor }) {
  const p = getProgram(programId);
  const m = p?.milestones.find((x) => x.id === milestoneId);
  if (!m) throw httpError(404, 'Milestone not found');
  m.done = !!done;
  if (m.done) for (const uid of p.cohort) pushNotif(uid, { type: 'program', title: `Milestone complete: ${m.title}`, body: `${p.title} (${p.cohortLabel}) just hit a milestone.`, link: '/researcher/programs' });
  recordAudit(actor, 'program.milestone', `${p.title}: ${m.title} → ${m.done ? 'done' : 'open'}`);
  schedulePersist();
  return p;
}

// Accept/reject a program application. Accepting admits the user to the cohort.
export function reviewProgramApplication({ id, status, reviewerId }) {
  const a = db.applications.find((x) => x.id === id && x.kind === 'program');
  if (!a) throw httpError(404, 'Application not found');
  if (a.status !== 'pending') throw httpError(400, 'Already reviewed');
  a.status = status === 'accepted' ? 'accepted' : 'rejected';
  a.reviewedBy = reviewerId;
  a.reviewedAt = now();
  const p = getProgram(a.programId);
  if (a.status === 'accepted' && p && !p.cohort.includes(a.userId)) {
    p.cohort.push(a.userId);
    pushNotif(a.userId, { type: 'program', title: `You're in: ${p.title}`, body: `Welcome to the ${p.cohortLabel || ''} cohort! Check your milestones.`, link: '/researcher/programs' });
  } else if (p) {
    pushNotif(a.userId, { type: 'program', title: `Update on ${p.title}`, body: 'Your program application was not accepted this round — more cohorts are coming.', link: '/researcher/programs' });
  }
  recordAudit({ id: reviewerId }, 'program.review', `${a.userName} → ${a.status} (${p?.title || a.programId})`);
  schedulePersist();
  return { ...a, user: getUserById(a.userId) ? { email: getUserById(a.userId).email, name: getUserById(a.userId).name } : null, program: p ? { title: p.title, cohortLabel: p.cohortLabel } : null };
}

// --- certificates (verifiable proof of role/completion) ---------------------

// Certificate type → the researcher tag that earns it (see RESEARCHER_TAGS in
// domain.js). Mirrors the official Synthica generator repos
// (AssociateResearcherGen / IndependentResearcherGen / LeadResearchGen /
// ChapterLeaderCertGen): same templates, same eligibility.
const CERT_TYPES = {
  associate: 'associate_researcher',
  independent: 'independent_researcher',
  lead: 'lead_researcher',
  chapter: 'chapter_leader',
};

const certCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const chunk = () => Array.from(randomBytes(4)).map((b) => alphabet[b % alphabet.length]).join('');
  return `SYN-${chunk()}-${chunk()}`;
};

// Which certificates this user can generate, and which they already hold.
export function myCertificates(userId) {
  const u = getResearcherById(userId);
  const tags = u?.tags || [];
  return {
    eligible: Object.entries(CERT_TYPES).filter(([, tag]) => tags.includes(tag)).map(([type]) => type),
    issued: db.certificates.filter((c) => c.userId === userId).map(({ id, code, type, name, issuedAt }) => ({ id, code, type, name, issuedAt })),
  };
}

// Idempotent: re-requesting an issued certificate returns the existing record
// (same verification code) instead of minting a new one.
export function issueCertificate({ userId, type }) {
  const tag = CERT_TYPES[type];
  if (!tag) throw httpError(400, 'Unknown certificate type');
  const u = getResearcherById(userId);
  if (!u) throw httpError(403, 'Certificates are issued to researchers');
  if (!(u.tags || []).includes(tag)) throw httpError(403, "You haven't earned this certificate yet");
  let cert = db.certificates.find((c) => c.userId === userId && c.type === type);
  if (!cert) {
    cert = { id: `crt_${Date.now()}`, code: certCode(), userId, name: u.name, type, issuedAt: now() };
    db.certificates.push(cert);
    recordAudit(u, 'certificate.issue', `${u.name} — ${type} (${cert.code})`);
    schedulePersist();
  }
  return cert;
}

// Public verification: anyone with the code can confirm a certificate is real.
export function verifyCertificate(code) {
  const c = db.certificates.find((x) => x.code === String(code || '').trim().toUpperCase());
  if (!c) return { valid: false };
  return { valid: true, name: c.name, type: c.type, issuedAt: c.issuedAt };
}

// Recent activity from the people a user follows (for their weekly digest).
export function recentFollowedActivity(userId, days = 7) {
  const u = getUserById(userId);
  const following = new Set((u && u.following) || []);
  const since = Date.now() - days * 24 * 3600 * 1000;
  return (db.activities || [])
    .filter((a) => following.has(a.actorId) && new Date(a.at).getTime() >= since)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 15)
    .map((a) => ({ actorName: getUserById(a.actorId)?.name || 'A member', text: a.text, at: a.at }));
}

// --- weekly digest data ------------------------------------------------------

// Everything the weekly email digest needs in one read: recipients plus the
// open opportunities, programs, and next week's deadlines.
export function digestData() {
  const inAWeek = Date.now() + 7 * 24 * 3600 * 1000;
  return {
    recipients: db.researchers
      .filter((u) => u.email && u.approved !== false)
      .map((u) => ({ id: u.id, name: u.name, email: u.email })),
    listings: db.listings.map((l) => ({ title: l.title, category: l.category, spots: l.spots, leadName: l.leadName })),
    programs: db.programs
      .filter((p) => p.status === 'open')
      .map((p) => ({ title: p.title, cohortLabel: p.cohortLabel, applyDeadline: p.applyDeadline })),
    events: db.events
      .filter((e) => e.dueAt && new Date(e.dueAt).getTime() > Date.now() && new Date(e.dueAt).getTime() < inAWeek)
      .map((e) => ({ title: e.title, type: e.type, dueAt: e.dueAt })),
  };
}

// Advanced roles a member can apply for (Associate Researcher is granted on
// onboarding approval — it's never an application, ROLE_WORKFLOWS §3.2 / §4).
const APPLICABLE_ROLES = new Set(['Lead Researcher', 'Independent Researcher', 'Chapter Leader']);

export function addApplication(app) {
  let answers = null;
  // You can't apply to a listing you lead.
  if (app.listingId) {
    const listing = db.listings.find((l) => l.id === app.listingId);
    if (listing && listing.leadId === app.userId) throw httpError(400, "You can't apply to your own listing");
    // Custom application mode (§5.4): collect the lead's questions and require
    // an answer to each one marked required, keyed by question id.
    if (listing && listing.customApplication && (listing.customQuestions || []).length) {
      answers = {};
      const given = (app.answers && typeof app.answers === 'object') ? app.answers : {};
      for (const q of listing.customQuestions) {
        const a = String(given[q.id] ?? '').trim().slice(0, 1000);
        if (q.required && !a) throw httpError(400, `Please answer: ${q.label}`);
        answers[q.id] = a;
      }
    }
  }
  // Role-upgrade applications (no listing): validate the requested role and the
  // required essay so the Moderator queue never receives a half-filled form.
  if (!app.listingId && app.role) {
    if (app.role === 'Associate Researcher')
      throw httpError(400, 'Associate Researcher is granted automatically — no application needed.');
    if (!APPLICABLE_ROLES.has(app.role)) throw httpError(400, 'Unknown role');
    const u = getResearcherById(app.userId);
    if (u && (u.tags || []).includes(ROLE_TO_TAG[app.role]))
      throw httpError(400, `You already hold the ${app.role} role.`);
    if (db.applications.some((a) => a.userId === app.userId && a.role === app.role && a.status === 'pending'))
      throw httpError(400, `You already have a pending ${app.role} application.`);
    if (!String(app.message || '').trim())
      throw httpError(400, 'Please answer the application questions before submitting.');
  }
  const { answers: _rawAnswers, ...rest } = app;
  const record = { id: `app_${db.applications.length + 1}`, status: 'pending', at: now(), ...rest, answers };
  db.applications.push(record);
  notifyEvent({ title: 'New application', body: `${record.userName} applied${record.role ? ` for ${record.role}` : ''}.` });
  schedulePersist();
  return record;
}

// A rejected sign-up revises their profile and asks for another review: flip
// their onboarding row back to pending and clear the rejection flag so the
// pending screen shows "under review" again (ROLE_WORKFLOWS §3.1).
export function resubmitOnboarding(userId) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  if (u.approved) throw httpError(400, 'Your membership is already active.');
  const a = db.applications
    .filter((x) => x.kind === 'onboarding' && x.userId === userId)
    .sort((x, y) => new Date(y.at) - new Date(x.at))[0];
  if (a) {
    a.status = 'pending';
    a.reviewedBy = null;
    a.reviewedAt = null;
    a.resubmittedAt = now();
  }
  u.onboardingRejected = false;
  notifyEvent({ title: '🔁 Membership resubmitted', body: `${u.name} updated their profile and asked for another review.` });
  schedulePersist();
  const { password, twoFactorSecret, ...safe } = u;
  return safe;
}

// --- researcher project tasks (Track 4) ------------------------------------

const memberOf = (p, userId) => p.members.includes(userId);
const getTask = (p, taskId) => p.tasks.find((t) => t.id === taskId);

// Any team member can add a task (incl. a "question" for the hierarchy).
export function addProjectTask({ projectId, userId, title, type, dueAt, assignedTo, requiresApproval }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can add tasks');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  const t = {
    id: `task_${Date.now()}`,
    title: title.trim(),
    type: ['reading', 'question'].includes(type) ? type : 'task',
    assignedTo: Array.isArray(assignedTo) ? assignedTo.filter((id) => memberOf(p, id)) : [],
    status: TASK_STATUS.TODO,
    done: false,
    requiresApproval: !!requiresApproval,
    createdBy: userId,
    dueAt: dueAt || null,
  };
  p.tasks.push(t);
  schedulePersist();
  return t;
}

// Toggle a member onto/off a task (anyone on the team can assign).
export function assignTask({ projectId, userId, taskId, memberId }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can assign');
  if (!memberOf(p, memberId)) throw httpError(400, 'That person is not on the team');
  const t = getTask(p, taskId);
  if (!t) throw httpError(404, 'Task not found');
  t.assignedTo = t.assignedTo.includes(memberId)
    ? t.assignedTo.filter((id) => id !== memberId)
    : [...t.assignedTo, memberId];
  schedulePersist();
  return t;
}

// A member starts a task. If it needs approval, it waits for the lead.
export function startTask({ projectId, userId, taskId }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can start tasks');
  const t = getTask(p, taskId);
  if (!t) throw httpError(404, 'Task not found');
  t.status = t.requiresApproval ? TASK_STATUS.AWAITING : TASK_STATUS.IN_PROGRESS;
  schedulePersist();
  return t;
}

// The lead approves (or sends back) a task that's awaiting approval to start.
export function approveTask({ projectId, userId, taskId, approve = true }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== userId) throw httpError(403, 'Only the lead can approve tasks');
  const t = getTask(p, taskId);
  if (!t) throw httpError(404, 'Task not found');
  if (t.status !== TASK_STATUS.AWAITING) throw httpError(409, 'Task is not awaiting approval');
  t.status = approve ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.TODO;
  schedulePersist();
  return t;
}

// Mark a task done (or reopen it).
export function completeTask({ projectId, userId, taskId, done = true }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can update tasks');
  const t = getTask(p, taskId);
  if (!t) throw httpError(404, 'Task not found');
  t.status = done ? TASK_STATUS.DONE : TASK_STATUS.IN_PROGRESS;
  t.done = done;
  schedulePersist();
  return t;
}

export function addProjectAnnouncement({ projectId, userId, body }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== userId) throw httpError(403, 'Only the project lead can post announcements');
  if (!body?.trim()) throw httpError(400, 'A message is required');
  const ann = { id: `ann_${Date.now()}`, at: now(), body: body.trim() };
  p.announcements.push(ann);
  schedulePersist();
  return ann;
}

// A researcher saves/updates the link to their résumé (for auto-applying).
export function updateResume(userId, resumeUrl) {
  const r = getResearcherById(userId);
  if (!r) throw httpError(404, 'Researcher not found');
  r.resumeUrl = safeUrl(resumeUrl, 400);
  schedulePersist();
  return { resumeUrl: r.resumeUrl };
}

// Contacts (name/email/discord) for everyone on a project — used by the team
// roster and the lead's "email everyone" action.
export function projectTeam(projectId) {
  const p = getProject(projectId);
  if (!p) return [];
  const roleOf = (mid) => (p.roles || []).find((r) => r.userId === mid)?.title || '';
  return p.members
    .map((mid) => getResearcherById(mid))
    .filter(Boolean)
    .map((m) => ({ id: m.id, name: m.name, email: m.email, discord: m.discord, isLead: m.id === p.leadId, role: roleOf(m.id), avatarUrl: m.avatarUrl || '', slug: m.slug || m.id }));
}

// Lead assigns (or clears, with an empty title) a member's role on the project —
// e.g. "Head of Data Collection". Roles auto-surface on the member's profile.
export function setProjectRole({ projectId, leadId, userId, title }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== leadId) throw httpError(403, 'Only the project lead can assign roles');
  if (!p.members.includes(userId)) throw httpError(400, 'That person is not on this project');
  if (!Array.isArray(p.roles)) p.roles = [];
  const clean = String(title || '').trim().slice(0, 60);
  p.roles = p.roles.filter((r) => r.userId !== userId);
  if (clean) {
    p.roles.push({ userId, title: clean });
    if (userId !== leadId) pushNotif(userId, { type: 'project', title: `You're now ${clean}`, body: `on ${p.title}`, link: `/researcher/project/${p.id}` });
  }
  recordAudit(getUserById(leadId), 'project_role', `${getResearcherById(userId)?.name}: ${clean || '(cleared)'} on ${p.title}`);
  schedulePersist();
  return p;
}

// One-click invite of an existing member (used by the "suggested people" list).
export function inviteToProjectById({ projectId, leadId, userId }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== leadId) throw httpError(403, 'Only the project lead can invite people');
  const person = getResearcherById(userId);
  if (!person) throw httpError(404, 'Person not found');
  if (p.members.includes(userId)) throw httpError(409, 'They are already on this project');
  p.members.push(userId);
  const lead = getUserById(leadId);
  pushNotif(userId, { type: 'project', title: `You were added to ${p.title}`, body: `Invited by ${lead?.name || 'the project lead'}`, link: `/researcher/project/${p.id}` });
  sendEmail({
    to: person.email,
    subject: `You've been added to "${p.title}" on Synthica`,
    text: `Hi ${person.name},\n\n${lead?.name || 'A project lead'} added you to the project "${p.title}".\nSign in to see it: ${process.env.FRONTEND_URL || 'https://app.synthica.org'}/researcher/project/${p.id}\n\n— The Synthica Team`,
  });
  recordAudit(lead, 'invite_member', `${person.name} -> ${p.title}`);
  schedulePersist();
  return { status: 'added', name: person.name };
}

// Suggested teammates for a lead: approved, public researchers not already on
// the team, ranked by how much their interests overlap the project's interests
// (the team's interests + the project category).
export function suggestedPeopleForProject(projectId, requesterId) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== requesterId) throw httpError(403, 'Only the project lead can see suggestions');
  const wanted = new Set();
  for (const mid of p.members) for (const i of (getResearcherById(mid)?.interests || [])) wanted.add(i.toLowerCase());
  if (p.category) wanted.add(p.category.toLowerCase());
  const memberSet = new Set(p.members);
  const pendingEmails = new Set((p.invites || []).map((i) => i.email));
  return db.researchers
    .filter((r) => r.approved !== false && r.public !== false && !memberSet.has(r.id) && !pendingEmails.has((r.email || '').toLowerCase()))
    .map((r) => {
      const shared = (r.interests || []).filter((i) => wanted.has(String(i).toLowerCase()));
      return {
        id: r.id, name: r.name, slug: r.slug || r.id, avatarUrl: r.avatarUrl || '',
        role: roleDisplay(r), blurb: r.blurb || '', institution: r.institution || '',
        interests: r.interests || [], shared, score: shared.length,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 12);
}

// Link a paper or media resource to a project (any member). Used to embed
// previews (Google Drive, YouTube, etc.) on the project page.
// Lead invites someone by email (e.g. teammates from the old system). If they
// already have an account they join immediately; otherwise the invite is held
// on the project and claimed automatically when that email registers.
export function inviteToProject({ projectId, leadId, email }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== leadId) throw httpError(403, 'Only the project lead can invite people');
  const addr = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw httpError(400, 'Enter a valid email address');
  const lead = getUserById(leadId);

  const existing = getUserByEmail(addr);
  if (existing) {
    if (p.members.includes(existing.id)) throw httpError(409, 'They are already on this project');
    p.members.push(existing.id);
    pushNotif(existing.id, { type: 'project', title: `You were added to ${p.title}`, body: `Invited by ${lead?.name || 'the project lead'}`, link: `/researcher/project/${p.id}` });
    sendEmail({
      to: addr,
      subject: `You've been added to "${p.title}" on Synthica`,
      text: `Hi ${existing.name},\n\n${lead?.name || 'A project lead'} added you to the project "${p.title}".\nSign in to see it: ${process.env.FRONTEND_URL || 'https://app.synthica.org'}\n\n— The Synthica Team`,
    });
    schedulePersist();
    return { status: 'added', name: existing.name };
  }

  if (!Array.isArray(p.invites)) p.invites = [];
  if (p.invites.some((i) => i.email === addr)) throw httpError(409, 'That email already has a pending invite');
  p.invites.push({ email: addr, by: leadId, at: now() });
  sendEmail({
    to: addr,
    subject: `${lead?.name || 'A Synthica lead'} invited you to "${p.title}"`,
    text: `Hi,\n\nYou've been invited to join the research project "${p.title}" on Synthica.\nCreate your account with this email address and you'll be added automatically:\n${process.env.FRONTEND_URL || 'https://app.synthica.org'}/register\n\n— The Synthica Team`,
  });
  recordAudit(lead, 'invite_member', `${addr} -> ${p.title}`);
  schedulePersist();
  return { status: 'invited', email: addr };
}

// Claim any project invites waiting on this email (called on registration).
function claimProjectInvites(user) {
  const addr = (user.email || '').toLowerCase();
  if (!addr) return;
  for (const p of db.projects) {
    const idx = (p.invites || []).findIndex((i) => i.email === addr);
    if (idx !== -1) {
      p.invites.splice(idx, 1);
      if (!p.members.includes(user.id)) p.members.push(user.id);
      pushNotif(user.id, { type: 'project', title: `You've joined ${p.title}`, body: 'Your invite was waiting for you.', link: `/researcher/project/${p.id}` });
    }
  }
}

export function addProjectLink({ projectId, userId, label, url }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can add links');
  if (!url?.trim()) throw httpError(400, 'A URL is required');
  if (!p.links) p.links = [];
  const safe = safeUrl(url, 500);
  if (!safe) throw httpError(400, 'That link isn’t a valid http(s) URL');
  const link = { id: `link_${Date.now()}`, label: String(label || url).trim().slice(0, 120), url: safe, addedBy: userId, at: now() };
  p.links.push(link);
  schedulePersist();
  return link;
}

export function deleteProjectLink({ projectId, linkId, userId }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can delete links');
  const idx = p.links.findIndex((l) => l.id === linkId);
  if (idx === -1) throw httpError(404, 'Link not found');
  p.links.splice(idx, 1);
  schedulePersist();
  return { success: true };
}
// --- direct messages + network ---------------------------------------------

const dmCard = (id) => {
  const u = getUserById(id);
  return { id, name: u?.name || 'Member', slug: u?.slug || id, avatarUrl: u?.avatarUrl || '', role: u ? roleDisplay(u) : '' };
};

export function sendMessage({ from, to, text, replyTo, mediaUrl, mediaType }) {
  if (from === to) throw httpError(400, "You can't message yourself");
  if (!getUserById(to)) throw httpError(404, 'Recipient not found');
  if (isBlockedBetween(from, to)) throw httpError(403, 'You can no longer message this person');
  if (!text?.trim() && !mediaUrl) throw httpError(400, 'Write a message or attach media');
  if (!Array.isArray(db.messages)) db.messages = [];
  
  // Get reply info if replying to a message
  let replyInfo = null;
  if (replyTo) {
    const parentMsg = (db.messages || []).find(m => m.id === replyTo);
    if (parentMsg) {
      const sender = getUserById(parentMsg.from);
      replyInfo = {
        replyToId: parentMsg.id,
        replyToContent: parentMsg.text,
        replyToSender: sender?.name || 'Unknown',
        replyToType: parentMsg.mediaUrl ? 'media' : 'text'
      };
    }
  }
  
  const msg = {
    id: uid('msg'),
    from,
    to,
    text: String(text || '').trim().slice(0, 4000),
    at: now(),
    read: false,
    delivered: false,
    mediaUrl: mediaUrl || null,
    mediaType: mediaType || null,
    reactions: {},
    isEdited: false,
    isPinned: false,
    ...replyInfo
  };
  
  db.messages.push(msg);
  pushNotif(to, { type: 'message', title: `New message from ${getUserById(from)?.name || 'a member'}`, body: msg.text.slice(0, 100) || 'Media attachment', link: `/researcher/messages/${from}` });
  emit(to, 'message', { from, text: msg.text, at: msg.at, mediaUrl: msg.mediaUrl });
  schedulePersist();
  return { ...msg, mine: true };
}

// Edit a message
export function editMessage(userId, messageId, newText) {
  const msg = (db.messages || []).find(m => m.id === messageId && m.from === userId);
  if (!msg) throw httpError(404, 'Message not found');
  msg.text = String(newText).trim().slice(0, 4000);
  msg.isEdited = true;
  msg.editedAt = now();
  schedulePersist();
  // Notify the other user
  const otherId = msg.to === userId ? msg.from : msg.to;
  emit(otherId, 'message_edited', { messageId, text: msg.text });
  return msg;
}

// Delete a message (soft delete - just clear content)
export function deleteMessage(userId, messageId) {
  const msg = (db.messages || []).find(m => m.id === messageId && m.from === userId);
  if (!msg) throw httpError(404, 'Message not found');
  msg.text = '[deleted]';
  msg.isDeleted = true;
  msg.mediaUrl = null;
  msg.mediaType = null;
  schedulePersist();
  const otherId = msg.to === userId ? msg.from : msg.to;
  emit(otherId, 'message_deleted', { messageId });
  return { success: true };
}

// Add/remove reaction to a message
export function toggleReaction(userId, messageId, emoji) {
  const msg = (db.messages || []).find(m => m.id === messageId);
  if (!msg) throw httpError(404, 'Message not found');
  if (!msg.reactions) msg.reactions = {};
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
  
  const idx = msg.reactions[emoji].indexOf(userId);
  if (idx >= 0) {
    msg.reactions[emoji].splice(idx, 1);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
  } else {
    msg.reactions[emoji].push(userId);
  }
  schedulePersist();
  
  const otherId = msg.to === userId ? msg.from : msg.to;
  emit(otherId, 'message_reaction', { messageId, reactions: msg.reactions });
  return msg.reactions;
}

// Mark message as delivered
export function markDelivered(userId, messageId) {
  const msg = (db.messages || []).find(m => m.id === messageId && m.to === userId);
  if (msg && !msg.delivered) {
    msg.delivered = true;
    schedulePersist();
    emit(msg.from, 'message_delivered', { messageId });
  }
  return { success: true };
}

// Mark all messages in thread as read
export function markThreadRead(userId, otherId) {
  let count = 0;
  for (const msg of db.messages || []) {
    if (msg.to === userId && msg.from === otherId && !msg.read) {
      msg.read = true;
      count++;
    }
  }
  if (count > 0) schedulePersist();
  return { count };
}

// Forward a message to another user
export function forwardMessage(userId, messageId, toUserId) {
  const originalMsg = (db.messages || []).find(m => m.id === messageId);
  if (!originalMsg) throw httpError(404, 'Original message not found');
  if (!getUserById(toUserId)) throw httpError(404, 'Recipient not found');
  if (isBlockedBetween(userId, toUserId)) throw httpError(403, 'You can no longer message this person');
  
  // Create forwarded message with reference to original
  const forwardedMsg = {
    id: uid('msg'),
    from: userId,
    to: toUserId,
    text: originalMsg.text,
    at: now(),
    read: false,
    delivered: false,
    mediaUrl: originalMsg.mediaUrl,
    mediaType: originalMsg.mediaType,
    reactions: {},
    isEdited: false,
    isPinned: false,
    isForwarded: true,
    originalFrom: originalMsg.from
  };
  
  db.messages.push(forwardedMsg);
  pushNotif(toUserId, { type: 'message', title: `💬 New message from ${getUserById(userId)?.name || 'a member'}`, body: forwardedMsg.text.slice(0, 100) || '📎 Media', link: `/researcher/messages/${userId}` });
  emit(toUserId, 'message', { from: userId, text: forwardedMsg.text, at: forwardedMsg.at });
  schedulePersist();
  return { ...forwardedMsg, mine: true };
}

// Get list of users for forwarding
export function getForwardTargets(userId) {
  return [...db.editors, ...db.researchers]
    .filter(u => u.id !== userId && !isBlockedBetween(userId, u.id))
    .map(u => ({ id: u.id, name: u.name, username: u.username }));
}

// One row per person you've exchanged messages with: last message + unread count.
export function listConversations(userId) {
  const byOther = new Map();
  for (const m of db.messages || []) {
    if (m.from !== userId && m.to !== userId) continue;
    const other = m.from === userId ? m.to : m.from;
    const cur = byOther.get(other);
    if (!cur || new Date(m.at) > new Date(cur.lastAt)) {
      byOther.set(other, { other, lastMessage: m.text, lastAt: m.at, mine: m.from === userId });
    }
  }
  const unread = {};
  for (const m of db.messages || []) if (m.to === userId && !m.read) unread[m.from] = (unread[m.from] || 0) + 1;
  return [...byOther.values()]
    .filter((c) => !isBlockedBetween(userId, c.other))
    .map((c) => ({ user: dmCard(c.other), lastMessage: c.lastMessage, lastAt: c.lastAt, mine: c.mine, unread: unread[c.other] || 0 }))
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}

// The thread with one person; marks their messages to you as read.
export function getThread(userId, otherId) {
  if (!getUserById(otherId)) throw httpError(404, 'User not found');
  let changed = false;
  const messages = (db.messages || [])
    .filter((m) => (m.from === userId && m.to === otherId) || (m.from === otherId && m.to === userId))
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .map((m) => {
      if (m.to === userId && !m.read) { m.read = true; changed = true; }
      // Mark as delivered when recipient sees the thread
      if (m.to === userId && !m.delivered) { m.delivered = true; }
      return {
        id: m.id,
        text: m.text,
        at: m.at,
        mine: m.from === userId,
        delivered: m.delivered,
        read: m.read,
        reactions: m.reactions || {},
        isEdited: m.isEdited || false,
        isPinned: m.isPinned || false,
        isDeleted: m.isDeleted || false,
        isForwarded: m.isForwarded || false,
        originalFrom: m.originalFrom,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        replyToId: m.replyToId,
        replyToContent: m.replyToContent,
        replyToSender: m.replyToSender,
        replyToType: m.replyToType,
        editedAt: m.editedAt
      };
    });
  if (changed) schedulePersist();
  return { user: dmCard(otherId), messages };
}

export const unreadMessageCount = (userId) => (db.messages || []).filter((m) => m.to === userId && !m.read).length;

// Your network: people you follow + people who follow you (with mutual flag).
export function networkFor(userId) {
  const u = getUserById(userId);
  const following = new Set((u && u.following) || []);
  const followers = [...db.editors, ...db.researchers].filter((x) => (x.following || []).includes(userId)).map((x) => x.id);
  const followerSet = new Set(followers);
  const card = (id) => ({ ...dmCard(id), mutual: following.has(id) && followerSet.has(id) });
  return {
    following: [...following].filter((id) => getUserById(id)).map(card),
    followers: followers.filter((id) => id !== userId).map(card),
  };
}

// --- following + personalized feed -----------------------------------------

export function followUser(userId, targetId) {
  if (userId === targetId) throw httpError(400, "You can't follow yourself");
  const u = getUserById(userId);
  if (!u || !getUserById(targetId)) throw httpError(404, 'User not found');
  if (!Array.isArray(u.following)) u.following = [];
  if (!u.following.includes(targetId)) u.following.push(targetId);
  schedulePersist();
  return { following: u.following };
}

export function unfollowUser(userId, targetId) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  u.following = (u.following || []).filter((id) => id !== targetId);
  schedulePersist();
  return { following: u.following };
}

// Directory of people with the viewer's follow state.
export function peopleDirectory(viewerId) {
  const u = getUserById(viewerId);
  const following = new Set((u && u.following) || []);
  return [...db.editors, ...db.researchers]
    .filter((x) => isVisible(x) && x.id !== viewerId)
    .map((x) => ({
      id: x.id, slug: x.slug || x.id, username: x.username || '', name: x.name, role: roleDisplay(x),
      institution: x.institution || '', blurb: x.blurb || '', avatarUrl: x.avatarUrl || '',
      interests: x.interests || [], following: following.has(x.id),
    }));
}

// Personalized feed: announcements + people you follow + interest matches.
export function feedFor(userId) {
  const u = getUserById(userId);
  const following = new Set((u && u.following) || []);
  const interests = ((u && u.interests) || []).map((s) => s.toLowerCase());
  const items = [];
  for (const n of db.news || []) items.push({ type: 'news', title: n.title, body: n.body, by: n.authorName, bannerUrl: n.bannerUrl || '', at: n.at });
  for (const c of chaptersOf(userId))
    for (const ann of c.announcements || [])
      items.push({ type: 'chapter', title: `${c.name}: ${ann.title}`, body: ann.body, by: ann.byName, at: ann.at });
  // Activity from people you follow (and yourself): joined a group, became a
  // lead, advanced a paper to a later round, etc.
  for (const a of db.activities || []) {
    if (a.actorId !== userId && !following.has(a.actorId)) continue;
    const actor = getUserById(a.actorId);
    items.push({
      type: 'activity',
      actor: { name: actor?.name || 'Member', slug: actor?.slug || a.actorId, avatarUrl: actor?.avatarUrl || '' },
      title: `${actor?.name || 'A member'} ${a.text}`,
      link: a.link || '', at: a.at,
    });
  }
  for (const p of db.publications) {
    if (p.authorUserId && following.has(p.authorUserId)) {
      items.push({ type: 'following', title: `New paper from ${getUserById(p.authorUserId)?.name || 'someone you follow'}`, body: p.title, doi: p.doi, at: p.publishedAt });
    } else if (interests.length) {
      const hay = `${p.title} ${(p.keywords || []).join(' ')} ${p.category}`.toLowerCase();
      if (interests.some((i) => i && hay.includes(i))) items.push({ type: 'suggested', title: `Matches your interests`, body: p.title, doi: p.doi, at: p.publishedAt });
    }
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return items.slice(0, 30);
}

// --- pathway (personal guided research to-dos) -----------------------------

export const listPathway = (userId) => (getResearcherById(userId)?.pathway) || [];

export function addPathway({ userId, title, deliverable, dueAt }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  if (!Array.isArray(u.pathway)) u.pathway = [];
  const item = { id: `pw_${Date.now()}`, title: title.trim(), deliverable: (deliverable || '').trim(), dueAt: dueAt || null, done: false };
  u.pathway.push(item);
  schedulePersist();
  return item;
}

// Seed a guided pathway based on the researcher's chosen track. "own" = start
// your own research; "join" = join an existing project. Idempotent per track —
// re-running with the same track won't duplicate steps.
const PATHWAY_TEMPLATES = {
  own: [
    { title: 'Pick a research question', deliverable: 'A one-sentence question + why it matters' },
    { title: 'Write a short literature scan', deliverable: '5–8 sources with one-line takeaways' },
    { title: 'Find a mentor or advisor', deliverable: 'One person who agreed to advise' },
    { title: 'Draft a project proposal', deliverable: '1-page outline: question, method, timeline' },
    { title: 'Create your project on Synthica', deliverable: 'Project page with goals + first tasks' },
  ],
  join: [
    { title: 'Browse open projects in the Research Hub', deliverable: '3 projects that fit your interests' },
    { title: 'Polish your profile + résumé', deliverable: 'Bio, interests, and résumé link filled in' },
    { title: 'Apply to a project or listing', deliverable: 'At least one application submitted' },
    { title: 'Complete your first assigned task', deliverable: 'One deliverable handed to your lead' },
    { title: 'Share an update with your team', deliverable: 'A progress note posted to the project' },
  ],
};

export function seedPathway({ userId, track }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  const template = PATHWAY_TEMPLATES[track];
  if (!template) throw httpError(400, 'Unknown track');
  if (!Array.isArray(u.pathway)) u.pathway = [];
  if (u.pathway.some((p) => p.track === track)) return u.pathway; // already seeded
  const base = Date.now();
  template.forEach((t, i) => {
    u.pathway.push({ id: `pw_${base}_${i}`, title: t.title, deliverable: t.deliverable, dueAt: null, done: false, track });
  });
  schedulePersist();
  return u.pathway;
}

export function togglePathway({ userId, itemId, done }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  const it = (u.pathway || []).find((p) => p.id === itemId);
  if (!it) throw httpError(404, 'Item not found');
  it.done = done !== undefined ? !!done : !it.done;
  schedulePersist();
  return it;
}

export function deletePathway({ userId, itemId }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  u.pathway = (u.pathway || []).filter((p) => p.id !== itemId);
  schedulePersist();
  return { ok: true };
}

// --- project ideas (brainstorm + vote) -------------------------------------

export function addIdea({ projectId, userId, text }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!p.members.includes(userId)) throw httpError(403, 'Only team members can add ideas');
  if (!text?.trim()) throw httpError(400, 'Idea text required');
  if (!p.ideas) p.ideas = [];
  const idea = { id: `idea_${Date.now()}`, text: text.trim(), by: userId, votes: [userId], chosen: false, at: now() };
  p.ideas.push(idea);
  schedulePersist();
  return idea;
}

export function voteIdea({ projectId, userId, ideaId }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!p.members.includes(userId)) throw httpError(403, 'Only team members can vote');
  const idea = (p.ideas || []).find((i) => i.id === ideaId);
  if (!idea) throw httpError(404, 'Idea not found');
  idea.votes = idea.votes || [];
  idea.votes = idea.votes.includes(userId) ? idea.votes.filter((v) => v !== userId) : [...idea.votes, userId];
  schedulePersist();
  return idea;
}

export function chooseIdea({ projectId, userId, ideaId }) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== userId) throw httpError(403, 'Only the lead can choose the idea');
  (p.ideas || []).forEach((i) => { i.chosen = i.id === ideaId; });
  schedulePersist();
  return p.ideas;
}

// --- chapters + onboarding (Track 4) ---------------------------------------

// Public self-registration for researchers. Requires a point of contact
// (email + Discord). Returns the new (safe) user; the route issues a token.
// --- referrals --------------------------------------------------------------

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genReferralCode(user) {
  const base = String(user.username || 'yel').replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || 'YEL';
  const taken = (c) => [...db.editors, ...db.researchers].some((u) => u.referralCode === c);
  let code;
  do {
    code = `${base}-${Array.from(randomBytes(3)).map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
  } while (taken(code));
  return code;
}

// Lazily assign + return a user's referral code (so seed/old accounts get one).
export function referralCodeFor(userId) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!u.referralCode) { u.referralCode = genReferralCode(u); schedulePersist(); }
  return u.referralCode;
}

const userByReferralCode = (code) => {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return [...db.editors, ...db.researchers].find((u) => u.referralCode === c) || null;
};

export function myReferralStats(userId) {
  const code = referralCodeFor(userId);
  const referred = db.researchers
    .filter((r) => r.referredBy === userId)
    .map((r) => ({ name: r.name, at: r.createdAt || '' }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  return { code, count: referred.length, referred };
}

// Admin leaderboard — who has referred the most members (for future rewards).
export function referralLeaderboard() {
  const counts = new Map();
  for (const r of db.researchers) if (r.referredBy) counts.set(r.referredBy, (counts.get(r.referredBy) || 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: getUserById(id)?.name || id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);
}

export function registerResearcher({ name, email, discord, password, username, resumeUrl, ref }) {
  if (!email?.trim()) throw httpError(400, 'Email is required');
  if (!password || password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

  const emailTrim = email.trim().toLowerCase();
  const displayName = (name?.trim())
    || emailTrim.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const uname = (username?.trim() || emailTrim.split('@')[0]).toLowerCase();
  const all = [...db.editors, ...db.researchers];
  if (all.some((u) => u.username.toLowerCase() === uname)) throw httpError(409, 'That username is taken');
  if (all.some((u) => u.email && u.email.toLowerCase() === emailTrim))
    throw httpError(409, 'An account with that email already exists');

  const user = {
    id: `usr_${Date.now()}`,
    name: displayName,
    username: uname,
    password: hashPassword(password),
    kind: 'researcher',
    tags: [],
    // New members are pending until a Moderator approves them (ROLE_WORKFLOWS §3.1).
    approved: false,
    onboarded: false,
    rolesIntroSeen: false,
    email: emailTrim,
    discord: (discord || '').trim(),
    resumeUrl: safeUrl(resumeUrl, 400),
    gpa: '',
    experienceSummary: '',
    researchExperience: null,
    leadershipExperience: null,
    wantsChapterLead: false,
    leadRecommended: false,
    pathway: [],
    slug: uname.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    institution: '',
    bio: '',
    blurb: '',
    avatarUrl: '',
    interests: [],
    links: [],
    following: [],
    public: true,
    emailVerified: false,
    createdAt: now(),
    referralCode: '',
    referredBy: null,
  };
  user.referralCode = genReferralCode(user);
  const referrer = userByReferralCode(ref);
  if (referrer && referrer.id !== user.id) {
    user.referredBy = referrer.id;
    pushNotif(referrer.id, { type: 'referral', title: 'Someone joined with your link', body: `${user.name} signed up — thanks for spreading the word!`, link: '/researcher/account' });
  }
  db.researchers.push(user);
  claimProjectInvites(user);
  // Surface every new member in the Moderator's onboarding queue (ROLE_WORKFLOWS §3.1).
  db.applications.push({
    id: `app_${db.applications.length + 1}`,
    kind: 'onboarding',
    userId: user.id,
    userName: user.name,
    listingId: null,
    role: null,
    message: 'New member sign-up — assign a role',
    status: 'pending',
    at: now(),
  });
  notifyEvent({ title: 'New member', body: `${user.name} joined Synthica.` });
  schedulePersist();
  const { password: _pw, ...safe } = user;
  return safe;
}

// --- email verification + password reset (password accounts) ---------------

export const getUserByEmail = (email) =>
  [...db.editors, ...db.researchers].find((u) => u.email && u.email.toLowerCase() === String(email).toLowerCase()) || null;

export function markEmailVerified(userId) {
  const u = getEditorById(userId) || getResearcherById(userId);
  if (!u) return false;
  u.emailVerified = true;
  schedulePersist();
  return true;
}

export function setPassword(userId, newPassword) {
  const u = getEditorById(userId) || getResearcherById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!newPassword || newPassword.length < 6) throw httpError(400, 'Password must be at least 6 characters');
  u.password = hashPassword(newPassword);
  schedulePersist();
  return true;
}

// --- global news / announcements -------------------------------------------

export function listNews() {
  return [...(db.news || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function addNews({ authorId, authorName, title, body, audience, bannerUrl }) {
  if (!title?.trim() || !body?.trim()) throw httpError(400, 'Title and body are required');
  const item = {
    id: `news_${Date.now()}`,
    title: title.trim().slice(0, 160),
    body: body.trim().slice(0, 4000),
    authorName: authorName || 'Synthica',
    audience: audience || 'all',
    bannerUrl: safeUrl(bannerUrl, 400),
    at: new Date().toISOString(),
  };
  if (!db.news) db.news = [];
  db.news.unshift(item);
  recordAudit({ id: authorId, name: authorName }, 'post_news', title);
  notifyEvent({ title: 'Announcement', body: `${title}` });
  for (const u of [...db.editors, ...db.researchers]) {
    pushNotif(u.id, { type: 'news', title: item.title, body: item.body.slice(0, 140), link: '' });
  }
  schedulePersist();
  return item;
}

// --- competitions board ----------------------------------------------------

export function listCompetitions() {
  return [...(db.competitions || [])].sort((a, b) => {
    // Soonest open deadline first; undated last.
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    return a.deadline ? -1 : b.deadline ? 1 : new Date(b.at) - new Date(a.at);
  });
}

export function addCompetition({ actor, title, description, url, category, deadline, prize }) {
  if (!title?.trim()) throw httpError(400, 'A title is required');
  if (!Array.isArray(db.competitions)) db.competitions = [];
  const c = {
    id: uid('cmp'),
    title: title.trim().slice(0, 160),
    description: String(description || '').trim().slice(0, 2000),
    url: safeUrl(url, 400),
    category: CATEGORIES.includes(category) ? category : '',
    deadline: deadline ? String(deadline).slice(0, 10) : '',
    prize: String(prize || '').trim().slice(0, 120),
    postedById: actor?.id || null,
    postedByName: actor?.name || 'Synthica',
    at: now(),
  };
  db.competitions.unshift(c);
  recordAudit(actor, 'post_competition', c.title);
  notifyEvent({ title: 'New competition', body: c.title });
  schedulePersist();
  return c;
}

export function deleteCompetition({ id, actor }) {
  const idx = (db.competitions || []).findIndex((c) => c.id === id);
  if (idx === -1) throw httpError(404, 'Competition not found');
  db.competitions.splice(idx, 1);
  recordAudit(actor, 'delete_competition', id);
  schedulePersist();
  return { ok: true };
}

// --- community feed (member posts, likes, comments) ------------------------

const authorCard = (id) => {
  const u = getUserById(id);
  return { id, name: u?.name || 'Member', slug: u?.slug || id, avatarUrl: u?.avatarUrl || '', role: u ? roleDisplay(u) : '' };
};

function shapePost(p, viewerId) {
  return {
    id: p.id,
    author: authorCard(p.authorId),
    text: p.text,
    linkUrl: p.linkUrl || '',
    imageUrl: p.imageUrl || '',
    likeCount: (p.likes || []).length,
    likedByMe: (p.likes || []).includes(viewerId),
    comments: (p.comments || []).filter((c) => !isBlockedBetween(viewerId, c.authorId)).map((c) => ({ id: c.id, author: authorCard(c.authorId), text: c.text, at: c.at })),
    commentCount: (p.comments || []).length,
    at: p.at,
    canDelete: p.authorId === viewerId || isStaff(getUserById(viewerId)),
  };
}

export function listPosts(viewerId) {
  return [...(db.posts || [])]
    .filter((p) => !isBlockedBetween(viewerId, p.authorId))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .map((p) => shapePost(p, viewerId));
}

export function createPost({ userId, text, linkUrl, imageUrl }) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (u.approved === false) throw httpError(403, 'Your account is pending approval');
  if (!text?.trim() && !linkUrl?.trim() && !imageUrl?.trim()) throw httpError(400, 'Write something to post');
  if (!Array.isArray(db.posts)) db.posts = [];
  const post = {
    id: uid('post'),
    authorId: userId,
    text: String(text || '').trim().slice(0, 2000),
    linkUrl: safeUrl(linkUrl, 400),
    imageUrl: safeUrl(imageUrl, 400),
    likes: [],
    comments: [],
    at: now(),
  };
  db.posts.unshift(post);
  schedulePersist();
  return shapePost(post, userId);
}

export function togglePostLike({ postId, userId }) {
  const p = (db.posts || []).find((x) => x.id === postId);
  if (!p) throw httpError(404, 'Post not found');
  if (!Array.isArray(p.likes)) p.likes = [];
  const i = p.likes.indexOf(userId);
  if (i === -1) {
    p.likes.push(userId);
    if (p.authorId !== userId) pushNotif(p.authorId, { type: 'post', title: `${getUserById(userId)?.name || 'Someone'} liked your post`, body: p.text.slice(0, 80), link: '/researcher/community' });
  } else {
    p.likes.splice(i, 1);
  }
  schedulePersist();
  return shapePost(p, userId);
}

export function addPostComment({ postId, userId, text }) {
  const p = (db.posts || []).find((x) => x.id === postId);
  if (!p) throw httpError(404, 'Post not found');
  if (!text?.trim()) throw httpError(400, 'Write a comment');
  if (!Array.isArray(p.comments)) p.comments = [];
  p.comments.push({ id: uid('cmt'), authorId: userId, text: String(text).trim().slice(0, 1000), at: now() });
  if (p.authorId !== userId) pushNotif(p.authorId, { type: 'post', title: `${getUserById(userId)?.name || 'Someone'} commented on your post`, body: String(text).slice(0, 80), link: '/researcher/community' });
  schedulePersist();
  return shapePost(p, userId);
}

export function deletePost({ postId, userId }) {
  const idx = (db.posts || []).findIndex((x) => x.id === postId);
  if (idx === -1) throw httpError(404, 'Post not found');
  const p = db.posts[idx];
  if (p.authorId !== userId && !isStaff(getUserById(userId))) throw httpError(403, 'Only the author or staff can delete this');
  db.posts.splice(idx, 1);
  schedulePersist();
  return { ok: true };
}

export const postCountFor = (userId) => (db.posts || []).filter((p) => p.authorId === userId).length;

// --- trust & safety: blocking, reporting, moderation -----------------------

// True if either side has blocked the other — used to hide content + stop DMs.
function isBlockedBetween(aId, bId) {
  if (!aId || !bId || aId === bId) return false;
  const a = getUserById(aId), b = getUserById(bId);
  return !!((a?.blockedUsers || []).includes(bId) || (b?.blockedUsers || []).includes(aId));
}

export function blockUser(userId, targetId) {
  if (userId === targetId) throw httpError(400, "You can't block yourself");
  const u = getUserById(userId);
  if (!u || !getUserById(targetId)) throw httpError(404, 'User not found');
  if (!Array.isArray(u.blockedUsers)) u.blockedUsers = [];
  if (!u.blockedUsers.includes(targetId)) u.blockedUsers.push(targetId);
  // Blocking unfollows both ways so they drop out of each other's feed/network.
  if (Array.isArray(u.following)) u.following = u.following.filter((id) => id !== targetId);
  const t = getUserById(targetId);
  if (t && Array.isArray(t.following)) t.following = t.following.filter((id) => id !== userId);
  schedulePersist();
  return { blocked: u.blockedUsers };
}

export function unblockUser(userId, targetId) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  u.blockedUsers = (u.blockedUsers || []).filter((id) => id !== targetId);
  schedulePersist();
  return { blocked: u.blockedUsers };
}

export function listBlocked(userId) {
  const u = getUserById(userId);
  return ((u && u.blockedUsers) || []).map((id) => dmCard(id));
}

const REPORT_KINDS = ['post', 'comment', 'message', 'profile'];

// Resolve what a report points at: its owner + a text snapshot for the queue.
function reportTargetSnapshot(kind, targetId) {
  if (kind === 'post') {
    const p = (db.posts || []).find((x) => x.id === targetId);
    return p ? { ownerId: p.authorId, text: p.text } : null;
  }
  if (kind === 'comment') {
    for (const p of db.posts || []) {
      const c = (p.comments || []).find((x) => x.id === targetId);
      if (c) return { ownerId: c.authorId, text: c.text, postId: p.id };
    }
    return null;
  }
  if (kind === 'message') {
    const m = (db.messages || []).find((x) => x.id === targetId);
    return m ? { ownerId: m.from, text: m.text } : null;
  }
  if (kind === 'profile') {
    const u = getUserById(targetId);
    return u ? { ownerId: u.id, text: u.bio || u.blurb || '' } : null;
  }
  return null;
}

const isModerator = (u) => u?.kind === 'editor'
  && [EDITOR_ROLES.AUDITOR, EDITOR_ROLES.DIRECTOR, EDITOR_ROLES.ADMIN].includes(u.role);

// A member flags a post/comment/message/profile for the moderation team.
export function reportContent({ reporterId, kind, targetId, reason }) {
  if (!REPORT_KINDS.includes(kind)) throw httpError(400, 'Unknown report type');
  const snap = reportTargetSnapshot(kind, targetId);
  if (!snap) throw httpError(404, 'That content no longer exists');
  if (snap.ownerId === reporterId) throw httpError(400, "You can't report your own content");
  if (!Array.isArray(db.reports)) db.reports = [];
  // One open report per reporter per target — clicking twice is a no-op.
  if (db.reports.some((r) => r.reporterId === reporterId && r.kind === kind && r.targetId === targetId && r.status === 'open'))
    return { ok: true, duplicate: true };
  const report = {
    id: uid('rpt'),
    kind, targetId,
    targetOwnerId: snap.ownerId,
    targetOwnerName: getUserById(snap.ownerId)?.name || 'Member',
    snippet: String(snap.text || '').slice(0, 280),
    postId: snap.postId || null,
    reason: String(reason || '').trim().slice(0, 500),
    reporterId, reporterName: getUserById(reporterId)?.name || 'Member',
    status: 'open',
    action: '', resolvedById: null, resolvedByName: '', resolvedAt: null,
    at: now(),
  };
  db.reports.unshift(report);
  // Ping the moderation team in-app.
  for (const ed of db.editors || []) {
    if (isModerator(ed)) pushNotif(ed.id, { type: 'report', title: 'New content report', body: `${report.reporterName} reported a ${kind}`, link: '/editor' });
  }
  schedulePersist();
  return { ok: true };
}

export function listReports(status = 'open') {
  return (db.reports || [])
    .filter((r) => (status === 'all' ? true : r.status === status))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

export const openReportCount = () => (db.reports || []).filter((r) => r.status === 'open').length;

// Moderator resolves a report: dismiss it, remove the content, or suspend the
// offending member (which also removes the reported content).
export function resolveReport({ id, actor, action }) {
  if (!isModerator(actor)) throw httpError(403, 'Moderators only');
  const r = (db.reports || []).find((x) => x.id === id);
  if (!r) throw httpError(404, 'Report not found');
  if (!['dismiss', 'remove', 'suspend'].includes(action)) throw httpError(400, 'Unknown action');

  if (action === 'remove' || action === 'suspend') {
    if (r.kind === 'post') {
      const i = (db.posts || []).findIndex((p) => p.id === r.targetId);
      if (i !== -1) db.posts.splice(i, 1);
    } else if (r.kind === 'comment') {
      for (const p of db.posts || []) {
        const ci = (p.comments || []).findIndex((c) => c.id === r.targetId);
        if (ci !== -1) { p.comments.splice(ci, 1); break; }
      }
    } else if (r.kind === 'message') {
      const i = (db.messages || []).findIndex((m) => m.id === r.targetId);
      if (i !== -1) db.messages.splice(i, 1);
    }
  }
  if (action === 'suspend' && r.targetOwnerId) {
    setUserSuspended({ userId: r.targetOwnerId, suspended: true, actor });
  }
  r.status = 'resolved';
  r.action = action;
  r.resolvedById = actor?.id || null;
  r.resolvedByName = actor?.name || 'staff';
  r.resolvedAt = now();
  recordAudit(actor, `report_${action}`, `${r.kind} by ${r.targetOwnerName}`);
  schedulePersist();
  return listReports('open');
}

// --- account self-service: data export + deletion --------------------------

// Everything a member can take with them (their own data only; no secrets).
export function exportMyData(userId) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  const { password, twoFactorSecret, ...profile } = u;
  const posts = (db.posts || []).filter((p) => p.authorId === userId).map((p) => ({ id: p.id, text: p.text, at: p.at, likes: (p.likes || []).length }));
  const comments = [];
  for (const p of db.posts || []) for (const c of p.comments || []) if (c.authorId === userId) comments.push({ postId: p.id, text: c.text, at: c.at });
  const messages = (db.messages || []).filter((m) => m.from === userId || m.to === userId)
    .map((m) => ({ direction: m.from === userId ? 'sent' : 'received', with: m.from === userId ? m.to : m.from, text: m.text, at: m.at }));
  const groups = (db.groups || []).filter((g) => (g.members || []).includes(userId)).map((g) => ({ id: g.id, name: g.name, leader: g.leaderId === userId }));
  const applications = (db.applications || []).filter((a) => a.userId === userId);
  const certificates = (db.certificates || []).filter((c) => c.userId === userId);
  return { exportedAt: now(), profile, posts, comments, messages, groups, applications, certificates };
}

// Permanently delete the member's account + the content tied to it. Owned
// structures (groups/projects) are handed to the next member or disbanded.
export function deleteMyAccount(userId) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (u.kind === 'editor') throw httpError(403, 'Staff accounts are managed by an administrator');

  db.posts = (db.posts || []).filter((p) => p.authorId !== userId);
  for (const p of db.posts) {
    if (Array.isArray(p.comments)) p.comments = p.comments.filter((c) => c.authorId !== userId);
    if (Array.isArray(p.likes)) p.likes = p.likes.filter((id) => id !== userId);
  }
  db.messages = (db.messages || []).filter((m) => m.from !== userId && m.to !== userId);
  db.notifications = (db.notifications || []).filter((n) => n.userId !== userId);
  db.applications = (db.applications || []).filter((a) => a.userId !== userId);
  db.listings = (db.listings || []).filter((l) => l.leadId !== userId);
  db.reports = (db.reports || []).filter((r) => r.reporterId !== userId && r.targetOwnerId !== userId);

  // Drop membership from every group/project; transfer or disband owned ones.
  for (const g of db.groups || []) {
    g.members = (g.members || []).filter((m) => m !== userId);
    (g.positions || []).forEach((pos) => { if (pos.filledBy === userId) pos.filledBy = null; });
  }
  db.groups = (db.groups || []).filter((g) => {
    if (g.leaderId !== userId) return true;
    if ((g.members || []).length === 0) return false;
    g.leaderId = g.members[0];
    return true;
  });
  for (const p of db.projects || []) p.members = (p.members || []).filter((m) => m !== userId);
  db.projects = (db.projects || []).filter((p) => {
    if (p.leadId !== userId) return true;
    if ((p.members || []).length === 0) return false;
    p.leadId = p.members[0];
    return true;
  });

  // Following + block graph, both directions.
  for (const x of [...db.editors, ...db.researchers]) {
    if (Array.isArray(x.following)) x.following = x.following.filter((id) => id !== userId);
    if (Array.isArray(x.blockedUsers)) x.blockedUsers = x.blockedUsers.filter((id) => id !== userId);
  }
  db.researchers = (db.researchers || []).filter((x) => x.id !== userId);
  recordAudit({ id: userId, name: u.name }, 'account_deleted', u.email || '');
  schedulePersist();
  return { ok: true };
}

// --- in-app notifications --------------------------------------------------

export function listNotifications(userId) {
  return (db.notifications || [])
    .filter((n) => n.userId === userId)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 50);
}

export function markNotificationsRead(userId, ids) {
  const set = Array.isArray(ids) && ids.length ? new Set(ids) : null;
  (db.notifications || []).forEach((n) => {
    if (n.userId === userId && (!set || set.has(n.id))) n.read = true;
  });
  schedulePersist();
  return { ok: true };
}

// --- shared calendar: lead-set deadlines + task/pathway due dates -----------

const EVENT_TYPES = ['task', 'paper', 'event', 'workshop', 'meetup'];
const isStaff = (u) => u?.kind === 'editor';

// Deadlines + events. Scoped to a project (lead), a chapter (leader), a research
// group (group leader), or platform-wide (staff only — e.g. global workshops).
// Everyone affected sees them on their Calendar page.
export function addEvent({ userId, title, type, dueAt, projectId, chapterId, groupId }) {
  const u = getUserById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) throw httpError(400, 'A valid date is required');
  let project = null;
  let chapter = null;
  let group = null;
  if (projectId) {
    project = getProject(projectId);
    if (!project) throw httpError(404, 'Project not found');
    if (project.leadId !== userId && !isStaff(u)) throw httpError(403, 'Only the project lead can set its deadlines');
  } else if (chapterId) {
    chapter = db.chapters.find((c) => c.id === chapterId);
    if (!chapter) throw httpError(404, 'Chapter not found');
    if (chapter.leaderId !== userId && !isStaff(u)) throw httpError(403, 'Only the chapter leader can set its events');
  } else if (groupId) {
    group = getGroup(groupId);
    if (!group) throw httpError(404, 'Group not found');
    if (group.leaderId !== userId && !isStaff(u)) throw httpError(403, 'Only the group leader can set its events');
  } else if (!isStaff(u)) {
    throw httpError(403, 'Pick one of your projects, your chapter, or a group — platform-wide events are staff-only');
  }
  if (!Array.isArray(db.events)) db.events = [];
  const ev = {
    id: uid('ev'),
    title: title.trim().slice(0, 140),
    type: EVENT_TYPES.includes(type) ? type : 'event',
    dueAt: String(dueAt).slice(0, 10),
    projectId: project?.id || null,
    chapterId: chapter?.id || null,
    groupId: group?.id || null,
    rsvps: [],
    createdBy: userId,
    createdByName: u.name,
    at: now(),
  };
  db.events.push(ev);
  // Tell the affected people right away.
  const audience = project
    ? project.members.filter((id) => id !== userId)
    : chapter
      ? (chapter.members || []).map((m) => m.userId).filter((id) => id !== userId)
      : group
        ? group.members.filter((id) => id !== userId)
        : [];
  const ctx = project?.title || chapter?.name || group?.name || '';
  for (const id of audience)
    pushNotif(id, { type: 'deadline', title: `New ${ev.type}: ${ev.title}`, body: `${ctx} · ${ev.dueAt}`, link: '/researcher/calendar' });
  recordAudit(u, 'add_event', `${ev.title} (${ev.dueAt})`);
  schedulePersist();
  return ev;
}

// RSVP to (or un-RSVP from) an event.
export function rsvpEvent({ eventId, userId, going }) {
  const ev = (db.events || []).find((e) => e.id === eventId);
  if (!ev) throw httpError(404, 'Event not found');
  if (!Array.isArray(ev.rsvps)) ev.rsvps = [];
  const i = ev.rsvps.indexOf(userId);
  if (going && i === -1) ev.rsvps.push(userId);
  if (!going && i !== -1) ev.rsvps.splice(i, 1);
  schedulePersist();
  return { eventId, rsvpCount: ev.rsvps.length, going: ev.rsvps.includes(userId) };
}

export function deleteEvent({ id, userId }) {
  const u = getUserById(userId);
  const idx = (db.events || []).findIndex((e) => e.id === id);
  if (idx === -1) throw httpError(404, 'Deadline not found');
  if (db.events[idx].createdBy !== userId && !isStaff(u)) throw httpError(403, 'Only the creator can remove this');
  db.events.splice(idx, 1);
  schedulePersist();
  return { ok: true };
}

// Everything with a date that concerns this user, normalized for the calendar:
// lead-set deadlines (their projects + platform-wide), project task due dates,
// and their own pathway steps.
export function calendarFor(userId) {
  const myProjects = db.projects.filter((p) => p.members.includes(userId));
  const myProjectIds = new Set(myProjects.map((p) => p.id));
  const items = [];
  const myChapterIds = new Set(chaptersOf(userId).map((c) => c.id));
  const myGroupIds = new Set((db.groups || []).filter((g) => (g.members || []).includes(userId)).map((g) => g.id));
  for (const ev of db.events || []) {
    if (ev.projectId && !myProjectIds.has(ev.projectId)) continue;
    if (ev.chapterId && !myChapterIds.has(ev.chapterId)) continue;
    if (ev.groupId && !myGroupIds.has(ev.groupId)) continue;
    const project = ev.projectId ? getProject(ev.projectId) : null;
    const chapter = ev.chapterId ? db.chapters.find((c) => c.id === ev.chapterId) : null;
    const group = ev.groupId ? getGroup(ev.groupId) : null;
    items.push({
      id: ev.id, date: ev.dueAt, title: ev.title, kind: ev.type,
      context: project?.title || chapter?.name || group?.name || 'All Synthica', byName: ev.createdByName,
      canDelete: ev.createdBy === userId,
      // RSVP applies to gatherings (not task/paper deadlines).
      eventId: ev.id,
      rsvpable: ['event', 'workshop', 'meetup'].includes(ev.type),
      rsvpCount: (ev.rsvps || []).length,
      going: (ev.rsvps || []).includes(userId),
    });
  }
  for (const p of myProjects)
    for (const t of p.tasks || [])
      if (t.dueAt && !t.done)
        items.push({ id: `${p.id}:${t.id}`, date: String(t.dueAt).slice(0, 10), title: t.title, kind: 'task', context: p.title, byName: '', canDelete: false });
  const me = getResearcherById(userId);
  for (const it of me?.pathway || [])
    if (it.dueAt && !it.done)
      items.push({ id: `pw:${it.id}`, date: String(it.dueAt).slice(0, 10), title: it.title, kind: 'pathway', context: 'My pathway', byName: '', canDelete: false });
  // Mentor calls the user is party to (either the mentor or the booking
  // researcher) surface on the calendar as a Google-Calendar-style entry.
  for (const b of db.mentorBookings || []) {
    if (b.status === 'cancelled') continue;
    if (b.mentorId !== userId && b.researcherId !== userId) continue;
    const amMentor = b.mentorId === userId;
    const other = getUserById(amMentor ? b.researcherId : b.mentorId);
    items.push({
      id: `mbk:${b.id}`, date: String(b.slot).slice(0, 10), title: amMentor ? `Mentoring call with ${other?.name || 'a researcher'}` : `Mentor call with ${other?.name || 'your mentor'}`,
      kind: 'mentor', context: amMentor ? 'You are mentoring' : 'Expertise mentoring', byName: '', canDelete: false,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

// --- Expertise mentors (ROLE_WORKFLOWS §7) ---------------------------------
// Researchers with the `expertise_mentor` tag advertise specialty areas and
// availability windows; any researcher can browse them and book a 1:1 call.
// Calendar sync is an in-app stub (no real Google OAuth) — bookings create
// calendar entries for both parties via calendarFor() reading db.mentorBookings.

const MENTOR_TAG = 'expertise_mentor';
const isMentor = (u) => Array.isArray(u?.tags) && u.tags.includes(MENTOR_TAG);

// A slot is bookable when it's in the future and not already claimed.
const slotIsOpen = (s) => !s.booked && new Date(s.slot).getTime() > Date.now();

// Shape a mentor (researcher record) into the card the directory/detail shows.
function mentorCard(u, { withSlots = false } = {}) {
  const all = (u.availability || []).slice().sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
  const open = all.filter(slotIsOpen);
  return {
    id: u.id,
    slug: u.slug || u.id,
    name: u.name,
    avatarUrl: u.avatarUrl || '',
    institution: (u.affiliations && u.affiliations[0]) || u.institution || '',
    specialties: u.specialties || [],
    mentorBio: u.mentorBio || u.bio || '',
    openSlots: open.length,
    // Detail view gets the actual open slots to pick from; the list view doesn't.
    slots: withSlots ? open.map((s) => ({ id: s.id, slot: s.slot })) : undefined,
  };
}

// Directory: every mentor, optionally filtered by a specialty string.
export function listMentors({ specialty } = {}) {
  const needle = String(specialty || '').trim().toLowerCase();
  return db.researchers
    .filter((u) => isMentor(u) && isVisible(u))
    .filter((u) => !needle || (u.specialties || []).some((s) => s.toLowerCase().includes(needle)))
    .map((u) => mentorCard(u))
    .sort((a, b) => b.openSlots - a.openSlots || a.name.localeCompare(b.name));
}

// The distinct specialty chips across all mentors (drives the filter UI).
export function mentorSpecialties() {
  const set = new Set();
  for (const u of db.researchers) if (isMentor(u)) for (const s of u.specialties || []) set.add(s);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// One mentor's detail (bio, specialties, open slots) for the booking view.
export function getMentor(id) {
  const u = getResearcherById(id) || getUserBySlug(id);
  if (!u || !isMentor(u) || !isVisible(u)) throw httpError(404, 'Mentor not found');
  return mentorCard(u, { withSlots: true });
}

// --- mentor self-service: own profile + availability -----------------------

// The signed-in mentor's own dashboard payload: editable profile, all their
// slots (open + booked), and their bookings split into upcoming / past.
export function mentorDashboard(userId) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!isMentor(u)) throw httpError(403, 'You are not an expertise mentor');
  const slots = (u.availability || [])
    .slice()
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot)))
    .map((s) => ({ id: s.id, slot: s.slot, booked: !!s.booked, past: new Date(s.slot).getTime() <= Date.now() }));
  return {
    specialties: u.specialties || [],
    mentorBio: u.mentorBio || '',
    calendarConnected: !!u.googleCalendarConnected, // stub flag; no real OAuth
    slots,
    bookings: bookingsForMentor(userId),
  };
}

// Edit specialties + bio. Specialties come in as an array or comma string.
export function setMentorProfile({ userId, specialties, mentorBio }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!isMentor(u)) throw httpError(403, 'You are not an expertise mentor');
  if (specialties !== undefined) {
    const list = Array.isArray(specialties) ? specialties : String(specialties).split(',');
    u.specialties = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].slice(0, 12);
  }
  if (mentorBio !== undefined) u.mentorBio = String(mentorBio).slice(0, 600);
  recordAudit(u, 'mentor_profile', `specialties=[${(u.specialties || []).join(', ')}]`);
  schedulePersist();
  return mentorDashboard(userId);
}

// Add an availability slot (a future datetime the mentor is open for a call).
export function addMentorSlot({ userId, slot }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!isMentor(u)) throw httpError(403, 'You are not an expertise mentor');
  const t = new Date(slot).getTime();
  if (!slot || Number.isNaN(t)) throw httpError(400, 'A valid date and time is required');
  if (t <= Date.now()) throw httpError(400, 'Pick a time in the future');
  if (!Array.isArray(u.availability)) u.availability = [];
  const iso = new Date(slot).toISOString();
  if (u.availability.some((s) => s.slot === iso)) throw httpError(409, 'You already have a slot at that time');
  u.availability.push({ id: uid('slot'), slot: iso, booked: false });
  schedulePersist();
  return mentorDashboard(userId);
}

// Remove an availability slot. A booked slot can't be dropped — cancel the
// booking instead (which notifies the researcher).
export function removeMentorSlot({ userId, slotId }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!isMentor(u)) throw httpError(403, 'You are not an expertise mentor');
  const idx = (u.availability || []).findIndex((s) => s.id === slotId);
  if (idx === -1) throw httpError(404, 'Slot not found');
  if (u.availability[idx].booked) throw httpError(409, 'That slot is booked — cancel the call first');
  u.availability.splice(idx, 1);
  schedulePersist();
  return mentorDashboard(userId);
}

// Stub: pretend to (dis)connect Google Calendar. Two-way sync is wireable later
// — this only flips an in-app flag so the UI can reflect the connection.
export function setMentorCalendarConnected({ userId, connected }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'User not found');
  if (!isMentor(u)) throw httpError(403, 'You are not an expertise mentor');
  u.googleCalendarConnected = !!connected;
  schedulePersist();
  return { connected: u.googleCalendarConnected };
}

// --- bookings --------------------------------------------------------------

const bookingView = (b) => {
  const mentor = getUserById(b.mentorId);
  const researcher = getUserById(b.researcherId);
  return {
    id: b.id, mentorId: b.mentorId, researcherId: b.researcherId,
    mentorName: mentor?.name || 'Mentor', mentorSlug: mentor?.slug || b.mentorId, mentorAvatarUrl: mentor?.avatarUrl || '',
    researcherName: researcher?.name || 'Researcher', researcherSlug: researcher?.slug || b.researcherId, researcherAvatarUrl: researcher?.avatarUrl || '',
    slot: b.slot, note: b.note || '', status: b.status, meetingUrl: b.meetingUrl || '', at: b.at,
    past: new Date(b.slot).getTime() <= Date.now(),
  };
};

// Bookings where the user is the mentor, newest-relevant first.
function bookingsForMentor(mentorId) {
  return (db.mentorBookings || [])
    .filter((b) => b.mentorId === mentorId)
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot)))
    .map(bookingView);
}

// A researcher books an open slot with a mentor. Creates the booking, claims
// the slot, mirrors it onto both calendars (via calendarFor), and notifies the
// mentor in-app. A confirmation email is best-effort (no-op without RESEND).
export function bookMentor({ researcherId, mentorId, slot, note }) {
  const researcher = getResearcherById(researcherId);
  if (!researcher) throw httpError(404, 'User not found');
  const mentor = getResearcherById(mentorId);
  if (!mentor || !isMentor(mentor)) throw httpError(404, 'Mentor not found');
  if (mentorId === researcherId) throw httpError(400, "You can't book yourself");

  // Resolve the requested slot: prefer a real availability slot, but accept a
  // raw datetime that matches an open one so the API stays forgiving.
  const wanted = slot && !Number.isNaN(new Date(slot).getTime()) ? new Date(slot).toISOString() : null;
  if (!wanted) throw httpError(400, 'Pick a valid time slot');
  const avail = (mentor.availability || []).find((s) => s.slot === wanted);
  if (!avail) throw httpError(404, 'That time slot is no longer offered');
  if (avail.booked) throw httpError(409, 'Sorry — that slot was just booked. Pick another.');

  avail.booked = true;
  if (!Array.isArray(db.mentorBookings)) db.mentorBookings = [];
  const booking = {
    id: uid('mbk'),
    mentorId,
    researcherId,
    slotId: avail.id,
    slot: wanted,
    note: String(note || '').slice(0, 500),
    status: 'confirmed',
    // A stand-in meeting link (a real integration would mint a Meet/Zoom URL).
    meetingUrl: `https://meet.synthica.org/${uid('call').replace('call_', '')}`,
    at: now(),
  };
  db.mentorBookings.push(booking);

  const when = new Date(wanted).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  // In-app notification to the mentor (the headline acceptance check).
  pushNotif(mentorId, {
    type: 'mentor',
    title: `📅 New mentoring booking from ${researcher.name}`,
    body: `${when}${booking.note ? ` — “${booking.note}”` : ''}`,
    link: '/researcher/mentor',
  });
  // Confirmation to the researcher: best-effort email (no-op without RESEND).
  if (researcher.email) {
    sendEmail({
      to: researcher.email,
      subject: `Your mentoring call with ${mentor.name} is booked`,
      html: `<p>You're booked for a 1:1 with <strong>${mentor.name}</strong> on <strong>${when}</strong>.</p>` +
        `<p>Join link: <a href="${booking.meetingUrl}">${booking.meetingUrl}</a></p>` +
        (booking.note ? `<p>Your note: ${booking.note}</p>` : ''),
    }).catch(() => {});
  }
  recordAudit(researcher, 'book_mentor', `${researcher.name} booked ${mentor.name} for ${wanted}`);
  schedulePersist();
  return bookingView(booking);
}

// A researcher's own bookings (as the person who booked the call).
export function myMentorBookings(researcherId) {
  return (db.mentorBookings || [])
    .filter((b) => b.researcherId === researcherId)
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot)))
    .map(bookingView);
}

// Cancel a booking. Either party can cancel; it frees the slot and notifies the
// other side so their calendar updates.
export function cancelMentorBooking({ userId, bookingId }) {
  const b = (db.mentorBookings || []).find((x) => x.id === bookingId);
  if (!b) throw httpError(404, 'Booking not found');
  if (b.mentorId !== userId && b.researcherId !== userId) throw httpError(403, 'Not your booking');
  if (b.status === 'cancelled') return bookingView(b);
  b.status = 'cancelled';
  // Release the mentor's slot so it can be offered again (if still in future).
  const mentor = getResearcherById(b.mentorId);
  const slot = (mentor?.availability || []).find((s) => s.id === b.slotId);
  if (slot) slot.booked = false;
  const canceller = getUserById(userId);
  const otherId = userId === b.mentorId ? b.researcherId : b.mentorId;
  const when = new Date(b.slot).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  pushNotif(otherId, {
    type: 'mentor',
    title: `Mentoring call cancelled`,
    body: `${canceller?.name || 'Someone'} cancelled the ${when} call.`,
    link: userId === b.mentorId ? '/researcher/calendar' : '/researcher/mentors',
  });
  recordAudit(canceller, 'cancel_mentor_booking', `${bookingId} (${b.slot})`);
  schedulePersist();
  return bookingView(b);
}
// Calendar items scoped to a single project: lead-set deadlines on this project
// plus any dated task due-dates. Powers the project page's Calendar section, so
// the team sees its own deadlines without the whole-platform feed.
export function projectEvents(projectId, userId) {
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (!memberOf(p, userId)) throw httpError(403, 'Only team members can view this calendar');
  const items = [];
  for (const ev of db.events || []) {
    if (ev.projectId !== p.id) continue;
    items.push({
      id: ev.id, date: ev.dueAt, title: ev.title, kind: ev.type,
      byName: ev.createdByName, canDelete: ev.createdBy === userId,
      eventId: ev.id,
      rsvpable: ['event', 'workshop', 'meetup'].includes(ev.type),
      rsvpCount: (ev.rsvps || []).length,
      going: (ev.rsvps || []).includes(userId),
    });
  }
  for (const t of p.tasks || [])
    if (t.dueAt && !t.done)
      items.push({ id: `${p.id}:${t.id}`, date: String(t.dueAt).slice(0, 10), title: t.title, kind: 'task', byName: '', canDelete: false });
  return items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// --- audit log + backup export ---------------------------------------------

export const listAudit = () => [...(db.audit || [])].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 500);

export function exportAll() {
  return db; // full snapshot for backup download
}


const onboardingPct = (membership) =>
  membership.onboarding.length
    ? Math.round((membership.onboarding.filter((s) => s.done).length / membership.onboarding.length) * 100)
    : 0;

const projectsForUser = (userId) => db.projects.filter((p) => p.members.includes(userId));

export const getChapterLedBy = (userId) => db.chapters.find((c) => c.leaderId === userId) || null;
const chaptersOf = (userId) => db.chapters.filter((c) => c.leaderId === userId || (c.members || []).some((m) => m.userId === userId));

// --- chapter join codes (Google-Classroom-style private entry) --------------
// Codes are 8 characters from an unambiguous alphabet (no 0/O/1/I/L) so they're
// easy to read aloud and type. Generation loops until the code is unique across
// all chapters.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const joinCodeTaken = (code) => db.chapters.some((c) => (c.joinCode || '').toUpperCase() === code);
function genJoinCode() {
  let code;
  do {
    code = Array.from(randomBytes(8)).map((b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
  } while (joinCodeTaken(code));
  return code;
}

// Lazily ensure a chapter has a join code (so seed/persisted chapters created
// before codes existed still get one on first read). Returns the code.
function ensureJoinCode(chapter) {
  if (!chapter.joinCode) { chapter.joinCode = genJoinCode(); schedulePersist(); }
  return chapter.joinCode;
}

// Leader rotates the join code (e.g. an old code leaked). Invalidates the old.
export function regenerateJoinCode(leaderId) {
  const chapter = getChapterLedBy(leaderId);
  if (!chapter) throw httpError(403, 'Only a chapter leader can regenerate the join code');
  chapter.joinCode = genJoinCode();
  recordAudit(getUserById(leaderId), 'chapter_regenerate_code', chapter.name);
  schedulePersist();
  return { joinCode: chapter.joinCode };
}

// A member joins a chapter by entering its 8-character code. Adds them to the
// roster with a fresh onboarding checklist (tagged as an associate) and
// notifies the chapter leader. Mirrors addChapterMember's side effects so a
// code-join and a leader-add land a member in the same shape.
export function joinChapterByCode({ userId, code }) {
  const u = getResearcherById(userId);
  if (!u) throw httpError(404, 'Researcher not found');
  const norm = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!norm) throw httpError(400, 'Enter a join code');
  const chapter = db.chapters.find((c) => (c.joinCode || '').toUpperCase() === norm);
  if (!chapter) throw httpError(404, "That join code didn't match any chapter. Double-check it with your chapter leader.");
  if (chapter.members.some((m) => m.userId === userId)) throw httpError(409, "You're already a member of this chapter");

  if (!Array.isArray(u.tags)) u.tags = [];
  if (!u.tags.includes('associate_researcher')) u.tags.push('associate_researcher');
  chapter.members.push({ userId, joinedAt: now(), onboarding: freshOnboarding() });
  pushNotif(chapter.leaderId, { type: 'chapter', title: `${u.name} joined ${chapter.name}`, body: 'A new member joined with your chapter code.', link: '/researcher/chapter' });
  notifyEvent({ title: 'Chapter member joined', body: `${u.name} joined ${chapter.name} with a join code.` });
  recordAudit(u, 'chapter_join_code', chapter.name);
  schedulePersist();
  return { chapterId: chapter.id, chapterName: chapter.name, location: chapter.location || '' };
}

// Chapter leader broadcasts to their chapter: stored on the chapter, shown in
// members' feeds, and pushed as a notification.
export function addChapterAnnouncement({ leaderId, title, body }) {
  const chapter = getChapterLedBy(leaderId);
  if (!chapter) throw httpError(403, 'Only a chapter leader can post chapter announcements');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  const lead = getUserById(leaderId);
  if (!Array.isArray(chapter.announcements)) chapter.announcements = [];
  const ann = { id: uid('cann'), title: title.trim().slice(0, 140), body: String(body || '').slice(0, 1000), byName: lead?.name || 'Chapter lead', at: now() };
  chapter.announcements.unshift(ann);
  for (const m of chapter.members || [])
    if (m.userId !== leaderId)
      pushNotif(m.userId, { type: 'chapter', title: `${chapter.name}: ${ann.title}`, body: ann.body.slice(0, 120), link: '/researcher' });
  recordAudit(lead, 'chapter_announcement', `${chapter.name}: ${ann.title}`);
  schedulePersist();
  return ann;
}
export const getChapterForUser = (userId) =>
  db.chapters.find((c) => c.members.some((m) => m.userId === userId)) || null;

// The current user's onboarding status (for the onboarding card on their dash).
export function myOnboarding(userId) {
  const chapter = getChapterForUser(userId);
  if (!chapter) return null;
  const membership = chapter.members.find((m) => m.userId === userId);
  return {
    chapterId: chapter.id,
    chapterName: chapter.name,
    handbookUrl: chapter.handbookUrl,
    steps: membership.onboarding,
    pct: onboardingPct(membership),
  };
}

// A member checks off (or unchecks) one of their onboarding steps.
export function setOnboardingStep({ userId, key, done }) {
  const chapter = getChapterForUser(userId);
  if (!chapter) throw httpError(404, 'You are not in a chapter');
  const membership = chapter.members.find((m) => m.userId === userId);
  const step = membership.onboarding.find((s) => s.key === key);
  if (!step) throw httpError(404, 'Unknown onboarding step');
  step.done = !!done;
  schedulePersist();
  return { steps: membership.onboarding, pct: onboardingPct(membership) };
}

// Chapter-leader dashboard: roster (contacts + onboarding + projects) + stats.
export function chapterView(leaderId) {
  const chapter = getChapterLedBy(leaderId);
  if (!chapter) return null;
  const members = chapter.members.map((m) => {
    const u = getResearcherById(m.userId);
    const projects = projectsForUser(m.userId).map((p) => p.title);
    return {
      userId: m.userId,
      name: u?.name || 'Member',
      email: u?.email || '',
      discord: u?.discord || '',
      joinedAt: m.joinedAt,
      onboardingPct: onboardingPct(m),
      onboarded: onboardingPct(m) === 100,
      projects,
    };
  });
  const stats = {
    members: members.length,
    fullyOnboarded: members.filter((m) => m.onboarded).length,
    avgOnboarding: members.length
      ? Math.round(members.reduce((s, m) => s + m.onboardingPct, 0) / members.length)
      : 0,
    activeProjects: new Set(members.flatMap((m) => m.projects)).size,
  };
  const announcements = chapter.announcements || [];
  return { id: chapter.id, name: chapter.name, location: chapter.location, handbookUrl: chapter.handbookUrl, joinCode: ensureJoinCode(chapter), members, stats, announcements };
}

// Leader adds a member by email: links an EXISTING account (look-up) or creates
// a new one. Either way they get tagged + a fresh onboarding checklist. People
// can exist without a chapter and be added here later.
export function addChapterMember({ leaderId, name, email, discord }) {
  const chapter = getChapterLedBy(leaderId);
  if (!chapter) throw httpError(403, 'Only a chapter leader can add members');
  if (!email?.trim()) throw httpError(400, 'An email is required');

  let user = getUserByEmail(email);
  let existing = !!user;
  if (user) {
    if (chapter.members.some((m) => m.userId === user.id)) throw httpError(409, 'They are already in this chapter');
  } else {
    if (!name?.trim()) throw httpError(400, 'Name is required to create a new member');
    user = {
      id: `usr_${Date.now()}`,
      name: name.trim(),
      username: email.trim().split('@')[0].toLowerCase(),
      password: hashPassword('demo1234'),
      kind: 'researcher',
      tags: [],
      email: email.trim(),
      discord: (discord || '').trim(),
      slug: email.trim().split('@')[0].toLowerCase(),
      resumeUrl: '', public: true, emailVerified: false, following: [], pathway: [], interests: [],
    };
    db.researchers.push(user);
  }
  if (!Array.isArray(user.tags)) user.tags = [];
  if (!user.tags.includes('associate_researcher')) user.tags.push('associate_researcher'); // get tagged
  chapter.members.push({ userId: user.id, joinedAt: now(), onboarding: freshOnboarding() });
  pushNotif(user.id, { type: 'chapter', title: `You were added to ${chapter.name}`, body: 'Welcome — finish your onboarding to get started.', link: '/researcher' });
  notifyEvent({ title: 'Chapter member added', body: `${user.name} joined ${chapter.name}.` });
  schedulePersist();
  return { id: user.id, name: user.name, email: user.email, discord: user.discord, existing };
}

// Chapter Leaders can create their chapter
export function createChapter({ leaderId, name, location, handbookUrl }) {
  const existing = db.chapters.find((c) => c.leaderId === leaderId);
  if (existing) throw httpError(409, 'You already lead a chapter');
  if (!name?.trim()) throw httpError(400, 'Chapter name is required');
  
  const user = getResearcherById(leaderId);
  if (!user) throw httpError(404, 'User not found');
  
  const chapter = {
    id: `chap_${uid('')}`,
    name: name.trim(),
    location: (location || '').trim(),
    handbookUrl: (handbookUrl || '').trim(),
    leaderId,
    members: [],
    announcements: [],
    createdAt: now(),
  };
  
  // If leader is not already a chapter_leader tag, add it
  if (!user.tags.includes('chapter_leader')) {
    user.tags.push('chapter_leader');
  }
  
  db.chapters.push(chapter);
  pushNotif(leaderId, { type: 'chapter', title: 'Chapter created!', body: `Your chapter "${name}" is ready. Start by onboarding members.`, link: '/researcher/chapter' });
  schedulePersist();
  return chapter;
}

// Progress logging for Chapter Leaders
export function addChapterProgress({ leaderId, title, description, type }) {
  const chapter = getChapterLedBy(leaderId);
  if (!chapter) throw httpError(403, 'You must lead a chapter to log progress');
  if (!title?.trim()) throw httpError(400, 'Title is required');
  
  if (!Array.isArray(db.chapterProgress)) db.chapterProgress = [];
  
  const progress = {
    id: `prog_${uid('')}`,
    chapterId: chapter.id,
    leaderId,
    title: title.trim(),
    description: (description || '').trim(),
    type: type || 'general', // general, member, event, recruitment, outreach
    createdAt: now(),
  };
  
  db.chapterProgress.push(progress);
  schedulePersist();
  return progress;
}

// Get progress entries for a chapter leader's chapter
export function getChapterProgress(leaderId) {
  const chapter = getChapterLedBy(leaderId);
  if (!chapter) return [];
  
  if (!Array.isArray(db.chapterProgress)) db.chapterProgress = [];
  
  return db.chapterProgress
    .filter((p) => p.chapterId === chapter.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// --- leads: create listings/projects + review their own applicants ---------

const isLead = (u) => u && Array.isArray(u.tags) && u.tags.includes('lead_researcher');

// --- Research Groups (interest hubs holding multiple projects) --------------

const getGroup = (id) => (db.groups || []).find((g) => g.id === id) || null;
const groupLeaderName = (g) => getUserById(g.leaderId)?.name || 'Lead';

// Public-ish list for discovery.
export function listGroups() {
  return (db.groups || []).map((g) => ({
    id: g.id, name: g.name, category: g.category || '', description: g.description || '',
    bannerUrl: g.bannerUrl || '', logoUrl: g.logoUrl || '', leaderName: groupLeaderName(g),
    memberCount: (g.members || []).length, projectCount: (g.projectIds || []).length,
  }));
}

// Full detail for the group page (members + their projects + positions + links).
export function groupDetail(groupId, viewerId) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  const members = (g.members || []).map((mid) => {
    const u = getResearcherById(mid) || getUserById(mid);
    return u ? { id: u.id, name: u.name, slug: u.slug || u.id, avatarUrl: u.avatarUrl || '', role: roleDisplay(u), isLeader: u.id === g.leaderId } : null;
  }).filter(Boolean);
  const projects = (g.projectIds || [])
    .map((pid) => getProject(pid))
    .filter(Boolean)
    .map((p) => ({ id: p.id, title: p.title, category: p.category, memberCount: p.members.length }));
  const positions = (g.positions || []).map((pos) => ({
    ...pos, filledByName: pos.filledBy ? (getUserById(pos.filledBy)?.name || '') : '',
  }));
  return {
    id: g.id, name: g.name, description: g.description || '', category: g.category || '',
    bannerUrl: g.bannerUrl || '', logoUrl: g.logoUrl || '', leaderId: g.leaderId, leaderName: groupLeaderName(g),
    members, projects, positions, links: g.links || [],
    isLeader: viewerId === g.leaderId, isMember: (g.members || []).includes(viewerId),
    // Projects the viewer leads that aren't yet in the group (for the "add project" picker).
    addableProjects: viewerId === g.leaderId
      ? db.projects.filter((p) => p.leadId === viewerId && !(g.projectIds || []).includes(p.id)).map((p) => ({ id: p.id, title: p.title }))
      : [],
  };
}

export function createGroup({ userId, name, description, category, bannerUrl, logoUrl }) {
  const u = getResearcherById(userId);
  if (!isLead(u)) throw httpError(403, 'Only lead researchers can create research groups');
  if (!name?.trim()) throw httpError(400, 'A group name is required');
  if (!Array.isArray(db.groups)) db.groups = [];
  const g = {
    id: uid('grp'),
    name: name.trim().slice(0, 100),
    description: String(description || '').trim().slice(0, 1200),
    category: CATEGORIES.includes(category) ? category : '',
    leaderId: userId,
    bannerUrl: safeUrl(bannerUrl, 400),
    logoUrl: safeUrl(logoUrl, 400),
    members: [userId],
    projectIds: [],
    positions: [],
    links: [],
    createdAt: now(),
  };
  db.groups.push(g);
  recordAudit(u, 'create_group', g.name);
  recordActivity(userId, 'group_founded', `founded the research group ${g.name}`, `/researcher/groups/${g.id}`);
  schedulePersist();
  return g;
}

// Group leader edits identity: name, description, category, banner, and logo.
export function updateGroup({ groupId, leaderId, name, description, category, bannerUrl, logoUrl }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  if (name !== undefined) {
    if (!String(name).trim()) throw httpError(400, 'A group name is required');
    g.name = String(name).trim().slice(0, 100);
  }
  if (description !== undefined) g.description = String(description || '').trim().slice(0, 1200);
  if (category !== undefined) g.category = CATEGORIES.includes(category) ? category : '';
  if (bannerUrl !== undefined) g.bannerUrl = safeUrl(bannerUrl, 400);
  if (logoUrl !== undefined) g.logoUrl = safeUrl(logoUrl, 400);
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

export function joinGroup({ groupId, userId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  if (!g.members.includes(userId)) {
    g.members.push(userId);
    if (userId !== g.leaderId) pushNotif(g.leaderId, { type: 'group', title: `${getUserById(userId)?.name || 'Someone'} joined ${g.name}`, body: '', link: `/researcher/groups/${g.id}` });
    if (userId !== g.leaderId) recordActivity(userId, 'group_joined', `joined the research group ${g.name}`, `/researcher/groups/${g.id}`);
  }
  schedulePersist();
  return groupDetail(groupId, userId);
}

export function leaveGroup({ groupId, userId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  if (userId === g.leaderId) throw httpError(400, 'The group leader can’t leave — transfer or delete the group instead');
  g.members = g.members.filter((m) => m !== userId);
  (g.positions || []).forEach((pos) => { if (pos.filledBy === userId) pos.filledBy = null; });
  schedulePersist();
  return groupDetail(groupId, userId);
}

const requireGroupLeader = (g, leaderId) => { if (g.leaderId !== leaderId) throw httpError(403, 'Only the group leader can do that'); };

export function addGroupProject({ groupId, leaderId, projectId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  const p = getProject(projectId);
  if (!p) throw httpError(404, 'Project not found');
  if (p.leadId !== leaderId) throw httpError(403, 'You can only add projects you lead');
  if (!Array.isArray(g.projectIds)) g.projectIds = [];
  if (!g.projectIds.includes(projectId)) g.projectIds.push(projectId);
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

export function removeGroupProject({ groupId, leaderId, projectId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  g.projectIds = (g.projectIds || []).filter((id) => id !== projectId);
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

export function addGroupPosition({ groupId, leaderId, title, description }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  if (!title?.trim()) throw httpError(400, 'A position title is required');
  if (!Array.isArray(g.positions)) g.positions = [];
  g.positions.push({ id: uid('pos'), title: title.trim().slice(0, 80), description: String(description || '').trim().slice(0, 200), filledBy: null });
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

// Assign a member to a position (userId null leaves it open).
export function fillGroupPosition({ groupId, leaderId, positionId, userId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  const pos = (g.positions || []).find((p) => p.id === positionId);
  if (!pos) throw httpError(404, 'Position not found');
  if (userId && !g.members.includes(userId)) throw httpError(400, 'Pick someone who is a group member');
  pos.filledBy = userId || null;
  if (userId) pushNotif(userId, { type: 'group', title: `You're now ${pos.title}`, body: `in ${g.name}`, link: `/researcher/groups/${g.id}` });
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

export function removeGroupPosition({ groupId, leaderId, positionId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  g.positions = (g.positions || []).filter((p) => p.id !== positionId);
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

export function addGroupLink({ groupId, leaderId, label, url }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  const safe = safeUrl(url, 400);
  if (!safe) throw httpError(400, 'That link isn’t a valid http(s) URL');
  if (!Array.isArray(g.links)) g.links = [];
  g.links.push({ id: uid('glink'), label: String(label || url).trim().slice(0, 80), url: safe });
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

export function removeGroupLink({ groupId, leaderId, linkId }) {
  const g = getGroup(groupId);
  if (!g) throw httpError(404, 'Group not found');
  requireGroupLeader(g, leaderId);
  g.links = (g.links || []).filter((l) => l.id !== linkId);
  schedulePersist();
  return groupDetail(groupId, leaderId);
}

// Groups the user leads or belongs to (for the profile + their groups list).
export function groupsForUser(userId) {
  return (db.groups || [])
    .filter((g) => (g.members || []).includes(userId) || g.leaderId === userId)
    .map((g) => ({ id: g.id, name: g.name, category: g.category || '', isLeader: g.leaderId === userId }));
}

// Normalize a lead-defined custom-question list into stable {id,label,required}
// records. Free-text questions only (the simplest structured field) — capped so
// a listing can't carry an unbounded form. Empty labels are dropped.
function cleanCustomQuestions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((q) => {
      const label = String((q && (q.label ?? q.question ?? q.text)) || '').trim().slice(0, 200);
      if (!label) return null;
      return {
        id: (q && q.id) || uid('q'),
        label,
        required: !(q && q.required === false),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function createListing({ userId, title, category, spots, description, bannerUrl, lookingFor, projectId, customApplication, customQuestions }) {
  const u = getResearcherById(userId);
  if (!isLead(u)) throw httpError(403, 'Only lead researchers can post listings');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  // Custom application mode (§5.4): when on, the lead's extra questions are
  // stored on the listing and applicants must answer them. The toggle only
  // sticks if at least one question exists.
  const questions = cleanCustomQuestions(customQuestions);
  const customOn = !!customApplication && questions.length > 0;
  // If the listing names a project this lead owns, accepted applicants join it.
  let linkedProjectId = null;
  if (projectId) {
    const p = db.projects.find((x) => x.id === projectId && x.leadId === userId);
    if (p) linkedProjectId = p.id;
  }
  const listing = {
    id: `list_${Date.now()}`, title: title.trim(), category: category || '',
    spots: Number(spots) || 1, leadName: u.name, leadId: userId,
    description: (description || '').trim(), bannerUrl: safeUrl(bannerUrl, 400),
    lookingFor: String(lookingFor || '').trim().slice(0, 200),
    projectId: linkedProjectId,
    customApplication: customOn,
    customQuestions: questions,
  };
  db.listings.push(listing);
  recordAudit({ id: userId, name: u.name }, 'create_listing', listing.title);
  schedulePersist();
  return listing;
}

export function createProject({ userId, title, category, description, customApplication, customQuestions, spots, publishListing = true }) {
  const u = getResearcherById(userId);
  if (!isLead(u)) throw httpError(403, 'Only lead researchers can create projects');
  if (!title?.trim()) throw httpError(400, 'A title is required');
  const p = { id: `proj_${Date.now()}`, title: title.trim(), category: category || '', description: (description || '').trim(), leadId: userId, members: [userId], announcements: [], tasks: [], links: [], ideas: [], roles: [] };
  db.projects.push(p);
  recordAudit({ id: userId, name: u.name }, 'create_project', p.title);
  recordActivity(userId, 'project_started', `started the project ${p.title}`, `/researcher/project/${p.id}`);
  // §5.2/§5.6: creating a project auto-publishes a recruiting listing on the
  // Research Hub, linked back to the project so accepted applicants join its team.
  let listing = null;
  if (publishListing) {
    listing = createListing({
      userId, title: p.title, category: p.category, spots,
      description: p.description, projectId: p.id, customApplication, customQuestions,
    });
  }
  schedulePersist();
  return { ...p, listing };
}

// Edit your own listing (recruiting posts evolve as spots fill).
export function updateListing({ listingId, leadId, title, category, spots, description, bannerUrl, lookingFor, customApplication, customQuestions }) {
  const l = db.listings.find((x) => x.id === listingId);
  if (!l) throw httpError(404, 'Listing not found');
  if (l.leadId !== leadId) throw httpError(403, 'Not your listing');
  if (typeof title === 'string' && title.trim()) l.title = title.trim().slice(0, 140);
  if (typeof category === 'string' && category) l.category = category;
  if (spots !== undefined) l.spots = Math.max(1, Number(spots) || 1);
  if (typeof description === 'string') l.description = description.trim().slice(0, 1000);
  if (typeof bannerUrl === 'string') l.bannerUrl = safeUrl(bannerUrl, 400);
  if (typeof lookingFor === 'string') l.lookingFor = lookingFor.trim().slice(0, 200);
  // Custom-question editing (§5.4): questions are replaced wholesale when
  // provided; the toggle only sticks if at least one question exists.
  if (customQuestions !== undefined) l.customQuestions = cleanCustomQuestions(customQuestions);
  if (customApplication !== undefined || customQuestions !== undefined) {
    l.customApplication = !!(customApplication ?? l.customApplication) && (l.customQuestions || []).length > 0;
  }
  recordAudit({ id: leadId }, 'edit_listing', l.title);
  schedulePersist();
  return l;
}

export function deleteListing({ listingId, leadId }) {
  const idx = db.listings.findIndex((x) => x.id === listingId);
  if (idx === -1) throw httpError(404, 'Listing not found');
  if (db.listings[idx].leadId !== leadId) throw httpError(403, 'Not your listing');
  const [l] = db.listings.splice(idx, 1);
  // Tell pending applicants instead of leaving them waiting on a ghost.
  for (const a of db.applications.filter((x) => x.listingId === l.id && x.status === 'pending')) {
    a.status = 'rejected';
    a.reviewedAt = now();
    pushNotif(a.userId, { type: 'application', title: 'A listing you applied to was closed', body: l.title, link: '/researcher/opportunities' });
  }
  recordAudit({ id: leadId }, 'delete_listing', l.title);
  schedulePersist();
  return { ok: true };
}

// A lead's own listings with the numbers they decide by: applicant funnel +
// each applicant's signals (resume, scores, blurb).
export function myListings(userId) {
  return db.listings
    .filter((l) => l.leadId === userId)
    .map((l) => {
      const apps = db.applications.filter((a) => a.listingId === l.id);
      const questions = l.customQuestions || [];
      const applicants = apps.map((a) => {
        const u = getUserById(a.userId);
        // Pair each custom answer with its question label so the lead sees the
        // Q&A directly on the review card (§5.4).
        const answers = (a.answers && questions.length)
          ? questions.map((q) => ({ id: q.id, label: q.label, answer: a.answers[q.id] || '' }))
          : [];
        return {
          id: a.id, userId: a.userId, name: a.userName, status: a.status,
          message: a.message || '', resumeUrl: a.resumeUrl || u?.resumeUrl || '', at: a.at,
          researchExperience: u?.researchExperience ?? null,
          leadershipExperience: u?.leadershipExperience ?? null,
          blurb: u?.blurb || '', slug: u?.slug || a.userId,
          institution: u?.institution || '', avatarUrl: u?.avatarUrl || '',
          answers,
        };
      }).sort((a, b) => new Date(b.at) - new Date(a.at));
      const stats = {
        applicants: apps.length,
        pending: apps.filter((a) => a.status === 'pending').length,
        approved: apps.filter((a) => a.status === 'approved').length,
        rejected: apps.filter((a) => a.status === 'rejected').length,
      };
      return { ...l, applicantsDetail: applicants, stats, filled: stats.approved };
    });
}

// Applications to listings this lead owns.
export function myListingApplications(userId) {
  const mine = new Set(db.listings.filter((l) => l.leadId === userId).map((l) => l.id));
  return db.applications.filter((a) => a.listingId && mine.has(a.listingId));
}

// A lead accepts/rejects an applicant to one of their own listings.
// On accept, the applicant joins the listing's linked project team (§5.6); the
// accepted-applicant count is what the Hub renders as filled spots.
export function reviewListingApplication({ leadId, appId, status }) {
  const a = db.applications.find((x) => x.id === appId);
  if (!a) throw httpError(404, 'Application not found');
  const listing = db.listings.find((l) => l.id === a.listingId);
  if (!listing || listing.leadId !== leadId) throw httpError(403, 'Not your listing');
  if (!['approved', 'rejected', 'pending'].includes(status)) throw httpError(400, 'Invalid status');
  a.status = status;
  a.reviewedBy = leadId;
  a.reviewedAt = now();
  // Accepting adds them to the project team (if the listing is linked to one).
  if (status === 'approved' && listing.projectId) {
    const p = db.projects.find((x) => x.id === listing.projectId);
    if (p && !p.members.includes(a.userId)) {
      p.members.push(a.userId);
      recordActivity(a.userId, 'joined_project', `joined ${p.title}`, `/researcher/project/${p.id}`);
    }
  }
  const link = (status === 'approved' && listing.projectId) ? `/researcher/project/${listing.projectId}` : '/researcher/opportunities';
  pushNotif(a.userId, { type: 'application', title: `Your application was ${status}`, body: listing.title, link });
  schedulePersist();
  return a;
}

// --- stats (Track 4 + Track 3) ---------------------------------------------

export function projectStats(projectId) {
  const p = getProject(projectId);
  if (!p) return null;
  const byType = {};
  let done = 0, inProgress = 0, awaiting = 0;
  for (const t of p.tasks) {
    byType[t.type] = (byType[t.type] || 0) + 1;
    if (t.status === TASK_STATUS.DONE) done++;
    else if (t.status === TASK_STATUS.IN_PROGRESS) inProgress++;
    else if (t.status === TASK_STATUS.AWAITING) awaiting++;
  }
  const total = p.tasks.length;
  return {
    members: p.members.length,
    tasksTotal: total,
    done,
    inProgress,
    awaiting,
    pctComplete: total ? Math.round((done / total) * 100) : 0,
    byType,
  };
}

// Editor activity stats from the submissions they've touched.
export function editorStats(editorId) {
  let reviewed = 0, approved = 0, declined = 0, active = 0;
  for (const s of db.submissions) {
    const mine = s.reviews.filter((r) => r.editorId === editorId);
    reviewed += mine.length;
    approved += mine.filter((r) => r.decision === 'approve').length;
    declined += mine.filter((r) => r.decision !== 'approve').length;
    if (s.stage !== STAGE.PUBLISHED && s.stage !== STAGE.REJECTED &&
        (s.assignee === editorId || s.assignedReviewers.includes(editorId))) {
      active++;
    }
  }
  return { reviewed, approved, declined, active };
}

// ============================================================
// SANDBOX PROJECTS (for Independent Researchers)
// ============================================================

// Get all sandbox projects for a user
export function listSandboxProjects(userId) {
  const projects = (db.sandboxProjects || []).filter(p => p.userId === userId);
  return projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

// Get a single sandbox project
export function getSandboxProject(userId, projectId) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  return p;
}

// Create a sandbox project
export function createSandboxProject({ userId, title, category, description }) {
  if (!title?.trim()) throw httpError(400, 'Title is required');
  const p = {
    id: `sandbox_${uid('')}`,
    userId,
    title: title.trim(),
    category: category || 'General',
    description: (description || '').trim(),
    tasks: [],
    notes: [],
    documents: [],
    createdAt: now(),
    updatedAt: now(),
    driveFolderId: null,
    lastSynced: null
  };
  if (!Array.isArray(db.sandboxProjects)) db.sandboxProjects = [];
  db.sandboxProjects.push(p);
  schedulePersist();
  return p;
}

// Update a sandbox project
export function updateSandboxProject(userId, projectId, updates) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  if (updates.title !== undefined) p.title = updates.title.trim();
  if (updates.category !== undefined) p.category = updates.category;
  if (updates.description !== undefined) p.description = updates.description.trim();
  p.updatedAt = now();
  schedulePersist();
  return p;
}

// Delete a sandbox project
export function deleteSandboxProject(userId, projectId) {
  const idx = (db.sandboxProjects || []).findIndex(p => p.id === projectId && p.userId === userId);
  if (idx < 0) throw httpError(404, 'Project not found');
  db.sandboxProjects.splice(idx, 1);
  schedulePersist();
  return { success: true };
}

// Add a task to sandbox project
export function addSandboxTask(userId, projectId, { title, description, priority, dueDate }) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const task = {
    id: `task_${uid('')}`,
    title: title.trim(),
    description: (description || '').trim(),
    priority: priority || 'medium',
    dueDate: dueDate || null,
    status: 'todo',
    createdAt: now()
  };
  p.tasks.push(task);
  p.updatedAt = now();
  schedulePersist();
  return task;
}

// Update a task
export function updateSandboxTask(userId, projectId, taskId, updates) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const task = p.tasks.find(t => t.id === taskId);
  if (!task) throw httpError(404, 'Task not found');
  if (updates.title !== undefined) task.title = updates.title.trim();
  if (updates.description !== undefined) task.description = updates.description.trim();
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
  if (updates.status !== undefined) task.status = updates.status;
  p.updatedAt = now();
  schedulePersist();
  return task;
}

// Delete a task
export function deleteSandboxTask(userId, projectId, taskId) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const idx = p.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) throw httpError(404, 'Task not found');
  p.tasks.splice(idx, 1);
  p.updatedAt = now();
  schedulePersist();
  return { success: true };
}

// Add a note to sandbox project
export function addSandboxNote(userId, projectId, { title, content }) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const note = {
    id: `note_${uid('')}`,
    title: title.trim() || 'Untitled Note',
    content: content || '',
    createdAt: now(),
    updatedAt: now()
  };
  p.notes.push(note);
  p.updatedAt = now();
  schedulePersist();
  return note;
}

// Update a note
export function updateSandboxNote(userId, projectId, noteId, { title, content }) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const note = p.notes.find(n => n.id === noteId);
  if (!note) throw httpError(404, 'Note not found');
  if (title !== undefined) note.title = title.trim() || 'Untitled Note';
  if (content !== undefined) note.content = content;
  note.updatedAt = now();
  p.updatedAt = now();
  schedulePersist();
  return note;
}

// Delete a note
export function deleteSandboxNote(userId, projectId, noteId) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const idx = p.notes.findIndex(n => n.id === noteId);
  if (idx < 0) throw httpError(404, 'Note not found');
  p.notes.splice(idx, 1);
  p.updatedAt = now();
  schedulePersist();
  return { success: true };
}

// Add a document reference
export function addSandboxDocument(userId, projectId, { name, type, url, size }) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const doc = {
    id: `doc_${uid('')}`,
    name,
    type,
    url,
    size: size || 0,
    addedAt: now()
  };
  p.documents.push(doc);
  p.updatedAt = now();
  schedulePersist();
  return doc;
}

// Delete a document
export function deleteSandboxDocument(userId, projectId, docId) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  const idx = p.documents.findIndex(d => d.id === docId);
  if (idx < 0) throw httpError(404, 'Document not found');
  p.documents.splice(idx, 1);
  p.updatedAt = now();
  schedulePersist();
  return { success: true };
}

// Update Drive folder ID after sync
export function setSandboxDriveFolder(userId, projectId, folderId) {
  const p = (db.sandboxProjects || []).find(p => p.id === projectId && p.userId === userId);
  if (!p) throw httpError(404, 'Project not found');
  p.driveFolderId = folderId;
  p.lastSynced = now();
  schedulePersist();
  return p;
}

// Synchronous in-memory default so the module is usable on import (e.g. tests)
// before init() runs. Placed last so all helper consts above are initialized.
// init() replaces this with the active provider's data at server startup.
db = buildSeed();
assignPendingReviewers();
