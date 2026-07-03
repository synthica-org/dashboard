// Synthica backend — single Express app serving three tracks:
//   Track 2: /api/journal     journal publications + DOI registry
//   Track 3: /api/editor      journal editor dashboard workflow
//   Track 4: /api/researcher  researcher dashboard
//
// Everything runs off an in-memory store (src/store.js) seeded from src/seed.js.
// Run: `npm install && npm start` (defaults to http://localhost:4000).

import express from 'express';
import compression from 'compression';
import cors from 'cors';

import { login, issueToken, issuePurposeToken, verifyPurposeToken } from './src/auth.js';
import { requireAuth, userFromToken } from './src/auth.js';

// Resolve the user from a Bearer token if present, without requiring it (used
// for public routes that behave slightly differently when signed in).
const optionalUser = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? userFromToken(h.slice(7)) : null;
};
import * as store from './src/store.js';
import * as notify from './src/notify.js';
import { sendEmail, emailEnabled, welcomeEmail, actionEmail } from './src/email.js';
import { verifyGoogleIdToken, googleEnabled, googleClientId } from './src/google.js';
import { CATEGORIES, EDITOR_ROLES } from './src/domain.js';
import { sendWeeklyDigests, maybeSendWeekly } from './src/digest.js';
import { citationFormats, crossrefBatchXml } from './src/doi.js';
import { ogCardPng, sharePageHtml } from './src/og.js';
import { uploadMiddleware, publicUrl, UPLOAD_DIR } from './src/uploads.js';

const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
// Marketing site base, used by per-paper share pages to forward to articles.
const SITE_URL = (process.env.SITE_URL || 'https://www.synthica.org').replace(/\/$/, '');

const app = express();
app.set('trust proxy', 1); // real client IP behind Render/Vercel proxies
app.use(compression()); // gzip JSON/HTML responses — big win for list payloads

// Fail fast in production if the token secret is missing.
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  console.error('FATAL: AUTH_SECRET must be set in production.');
  process.exit(1);
}
// Loud warning if production runs without persistence: every restart wipes
// users, papers, and applications back to the demo seed.
if (process.env.NODE_ENV === 'production' && (process.env.DATA_PROVIDER || 'memory').toLowerCase() === 'memory') {
  console.warn('[data] DATA_PROVIDER=memory in production — ALL DATA IS LOST ON RESTART. Set DATA_PROVIDER=sheets.');
}
// Without an email provider, verification + password reset silently no-op.
if (process.env.NODE_ENV === 'production' && !emailEnabled()) {
  console.warn('[email] RESEND_API_KEY not set — password reset & verification emails will NOT be delivered.');
}

// CORS: lock to CORS_ORIGINS (comma-separated) if set; otherwise open (dev).
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins }));
} else {
  if (process.env.NODE_ENV === 'production') console.warn('[cors] CORS_ORIGINS not set — allowing all origins.');
  app.use(cors());
}
app.use(express.json({ limit: '1mb' }));

// Serve uploaded files (avatars, résumés, PDFs) with a long cache + CORS.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin') }));

// Baseline security headers (helmet-lite, no dependency).
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Tiny in-memory rate limiter (per IP+path). Protects the auth endpoints from
// brute force without an external dependency.
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    // Evict expired windows so the map can't grow without bound under a
    // long-running process (one entry per client IP per path).
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    let rec = hits.get(key);
    if (!rec || now > rec.reset) rec = { count: 0, reset: now + windowMs };
    rec.count += 1;
    hits.set(key, rec);
    if (rec.count > max) {
      const retry = Math.ceil((rec.reset - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    }
    next();
  };
}
const authLimiter = rateLimiter({ windowMs: 60_000, max: 10 });

// Turn thrown { status, message } errors into JSON responses. Unexpected 5xx
// errors are logged server-side (with method+path) so production failures are
// visible instead of vanishing into a generic JSON body.
const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.path} →`, err.stack || err.message);
    res.status(status).json({ error: err.message || 'Server error' });
  }
};

app.get('/api/health', (_req, res) => res.json({ ok: true, categories: CATEGORIES }));

// --- Public (no auth): impact stats, programs, certificate verification -----
app.get('/api/public/stats', wrap((_req, res) => res.json(store.publicStats())));
app.get('/api/public/programs', wrap((_req, res) => res.json(store.listPublicPrograms())));
app.get('/api/certificates/:code', wrap((req, res) => res.json(store.verifyCertificate(req.params.code))));

// --- Auth ------------------------------------------------------------------
app.post('/api/login', authLimiter, wrap((req, res) => {
  const { username, identifier, password } = req.body || {};
  const result = login(identifier || username, password);
  if (!result) return res.status(401).json({ error: 'Invalid username or password' });
  // If 2FA is on, require a second step before issuing the real token.
  if (store.twoFactorRequired(result.user.id)) {
    return res.json({ twoFactorRequired: true, tempToken: issuePurposeToken(result.user.id, '2fa', 300) });
  }
  res.json(result);
}));

// Smart sign-in step 1: is this email known, and how does it sign in?
app.post('/api/auth/check-email', authLimiter, wrap((req, res) => {
  res.json(store.lookupEmail((req.body || {}).email));
}));

// Second factor: exchange the temp token + TOTP code for a session token.
app.post('/api/2fa/verify', authLimiter, wrap((req, res) => {
  const { tempToken, code } = req.body || {};
  const id = verifyPurposeToken(tempToken, '2fa');
  if (!id) return res.status(401).json({ error: '2FA session expired — sign in again' });
  if (!store.verifyTwoFactorCode(id, code)) return res.status(401).json({ error: 'Invalid code' });
  const u = store.getUserById(id);
  const { password, twoFactorSecret, ...user } = u;
  res.json({ token: issueToken(u), user });
}));

// 2FA enrollment (authenticated).
app.post('/api/2fa/setup', requireAuth, wrap((req, res) => res.json(store.startTwoFactorSetup(req.user.id))));
app.post('/api/2fa/enable', requireAuth, wrap((req, res) => res.json(store.enableTwoFactor(req.user.id, (req.body || {}).code))));
app.post('/api/2fa/disable', requireAuth, wrap((req, res) => res.json(store.disableTwoFactor(req.user.id, (req.body || {}).code))));

// Tells the frontend which auth options are available.
app.get('/api/config', (_req, res) => res.json({ googleEnabled: googleEnabled(), googleClientId: googleClientId(), demoLogins: store.demoLoginsEnabled(), emailConfigured: emailEnabled() }));

// Google Sign-In: verify the ID token, find/create the user, issue our token.
app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    const { credential } = req.body || {};
    const profile = await verifyGoogleIdToken(credential);
    const user = store.findOrCreateGoogleUser(profile);
    res.json({ token: issueToken(user), user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Google sign-in failed' });
  }
});

app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

// File uploads — POST multipart 'file' with ?kind=avatar|resume|pdf|image.
app.post('/api/uploads', requireAuth, (req, res) => {
  const kind = ['avatar', 'resume', 'pdf', 'image'].includes(req.query.kind) ? req.query.kind : 'image';
  uploadMiddleware(kind)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.json({ url: publicUrl(req, req.file.filename), name: req.file.originalname, size: req.file.size });
  });
});

// Edit your own public profile.
app.put('/api/me/profile', requireAuth, wrap((req, res) => {
  res.json(store.updateProfile(req.user.id, req.body || {}));
}));

// --- Public profiles (no auth) ---------------------------------------------
app.get('/api/profiles', wrap((_req, res) => res.json(store.listProfiles())));
app.get('/api/profiles/:id', wrap((req, res) => {
  const p = store.getPublicProfile(req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  // Count the view (skips the owner's own visits when signed in).
  store.recordProfileView(req.params.id, optionalUser(req)?.id);
  res.json(p);
}));

// Personal stats (profile views, posts, …) for the signed-in member.
app.get('/api/me/stats', requireAuth, wrap((req, res) => res.json(store.myStats(req.user.id))));

// --- Admin: analytics, application review, audit, backup -------------------
// The platform Admin account passes every admin gate — it sees everything.
const requireDirector = (req, res, next) =>
  req.user.kind === 'editor' && [EDITOR_ROLES.DIRECTOR, EDITOR_ROLES.ADMIN].includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Director only' });

// Auditor, Director, or Admin — reviews sign-ups + applications + audit log.
const requireAuditor = (req, res, next) =>
  req.user.kind === 'editor' && [EDITOR_ROLES.DIRECTOR, EDITOR_ROLES.AUDITOR, EDITOR_ROLES.ADMIN].includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Auditor or Director only' });

// Senior editors and up can post global news.
const canPostNews = (req, res, next) =>
  req.user.kind === 'editor' && [EDITOR_ROLES.SENIOR, EDITOR_ROLES.CHIEF, EDITOR_ROLES.DIRECTOR, EDITOR_ROLES.ADMIN].includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Senior editors and up only' });

app.get('/api/admin/analytics', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.analytics())));

app.get('/api/admin/applications', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.allApplications())));

app.post('/api/admin/applications/:id', requireAuth, requireAuditor, wrap((req, res) => {
  const { status, assignTag, feedback } = req.body || {};
  res.json(store.setApplicationStatus({ id: req.params.id, status, assignTag, feedback, reviewerId: req.user.id }));
}));

// Independent project proposals — Moderator queue (dedicated, in addition to the
// shared /admin/applications view) so Unit 15 can list + approve/reject them.
app.get('/api/admin/proposals', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.listProposals())));
app.post('/api/admin/proposals/:id', requireAuth, requireAuditor, wrap((req, res) => {
  const { status, feedback } = req.body || {};
  res.json(store.reviewProposal({ id: req.params.id, status, feedback, reviewerId: req.user.id }));
}));

// Auditors assign/remove researcher tags directly (role assignment).
app.post('/api/admin/users/:id/tags', requireAuth, requireAuditor, wrap((req, res) => {
  const { addTags, removeTags } = req.body || {};
  res.json(store.auditorSetTags({ userId: req.params.id, addTags, removeTags, actor: req.user }));
}));

app.get('/api/admin/audit', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.listAudit())));

// Moderation queue — content reports filed by members.
app.get('/api/admin/reports', requireAuth, requireAuditor, wrap((req, res) => res.json(store.listReports(req.query.status || 'open'))));
app.post('/api/admin/reports/:id/resolve', requireAuth, requireAuditor, wrap((req, res) => res.json(store.resolveReport({ id: req.params.id, actor: req.user, action: (req.body || {}).action }))));

// --- Paper archive: admin upload + self-archive verification (auditor) ------
app.get('/api/admin/publications', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.adminListPublications())));

app.post('/api/admin/publications', requireAuth, requireAuditor, wrap((req, res) => {
  res.json(store.archivePublication(req.body || {}, req.user));
}));

app.delete('/api/admin/publications/:id', requireAuth, requireAuditor, wrap((req, res) => {
  res.json(store.deletePublication({ id: req.params.id, actor: req.user }));
}));

app.get('/api/admin/archive-queue', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.listArchiveQueue())));

app.put('/api/admin/publications/:id', requireAuth, requireAuditor, wrap((req, res) => {
  res.json(store.editPublication({ id: req.params.id, patch: req.body || {}, actor: req.user }));
}));

app.post('/api/admin/publications/:id/feature', requireAuth, requireAuditor, wrap((req, res) => {
  res.json(store.featurePublication({ id: req.params.id, featured: !!(req.body || {}).featured, actor: req.user }));
}));

app.post('/api/admin/publications/:id/verify', requireAuth, requireAuditor, wrap((req, res) => {
  const { status } = req.body || {};
  res.json(store.verifyPublication({ id: req.params.id, status, reviewerId: req.user.id }));
}));

// People lookup (auditors review/re-assign researcher roles; directors get
// editor-role powers via the routes below).
app.get('/api/admin/users', requireAuth, requireAuditor, wrap((req, res) => res.json(store.adminListUsers(req.query.q))));

app.post('/api/admin/users/:id/role', requireAuth, requireDirector, wrap((req, res) => {
  const { kind, role, category, addTags, removeTags } = req.body || {};
  res.json(store.adminSetUserRole({ userId: req.params.id, kind, role, category, addTags, removeTags, actor: req.user }));
}));

app.post('/api/admin/bulk-role', requireAuth, requireDirector, wrap((req, res) => {
  const { emails, tag, role } = req.body || {};
  res.json(store.adminBulkRole({ emails, tag, role, actor: req.user }));
}));

// --- Programs (apply → cohort → milestones) ----------------------------------
app.get('/api/researcher/programs', requireAuth, wrap((req, res) => res.json(store.listProgramsFor(req.user.id))));
app.post('/api/researcher/programs/:id/apply', requireAuth, wrap((req, res) => {
  res.json(store.applyToProgram({ programId: req.params.id, userId: req.user.id, message: (req.body || {}).message }));
}));

app.get('/api/admin/programs', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.listProgramsAdmin())));
app.post('/api/admin/programs', requireAuth, requireDirector, wrap((req, res) => res.json(store.createProgram(req.body || {}, req.user))));
app.post('/api/admin/programs/:id/status', requireAuth, requireDirector, wrap((req, res) => {
  res.json(store.updateProgramStatus({ programId: req.params.id, status: (req.body || {}).status, actor: req.user }));
}));
app.post('/api/admin/programs/:id/milestones', requireAuth, requireDirector, wrap((req, res) => {
  const { title, dueAt } = req.body || {};
  res.json(store.addProgramMilestone({ programId: req.params.id, title, dueAt, actor: req.user }));
}));
app.post('/api/admin/programs/:id/milestones/:mid', requireAuth, requireDirector, wrap((req, res) => {
  res.json(store.toggleProgramMilestone({ programId: req.params.id, milestoneId: req.params.mid, done: !!(req.body || {}).done, actor: req.user }));
}));
app.post('/api/admin/program-applications/:id', requireAuth, requireAuditor, wrap((req, res) => {
  const out = store.reviewProgramApplication({ id: req.params.id, status: (req.body || {}).status, reviewerId: req.user.id });
  if (out.user?.email && out.program) {
    sendEmail({
      to: out.user.email,
      subject: out.status === 'accepted' ? `Welcome to ${out.program.title}!` : `Update on your ${out.program.title} application`,
      text: out.status === 'accepted'
        ? `Hi ${out.user.name},\n\nYou're in! Welcome to ${out.program.title}${out.program.cohortLabel ? ` (${out.program.cohortLabel})` : ''}. Your milestones are waiting in the dashboard:\n${FRONTEND_URL || ''}/researcher/programs\n\n— The Synthica Team`
        : `Hi ${out.user.name},\n\nThank you for applying to ${out.program.title}. We couldn't offer you a spot this round, but new cohorts open regularly — keep an eye on the dashboard.\n\n— The Synthica Team`,
    });
  }
  res.json(out);
}));

// --- Certificates -------------------------------------------------------------
app.get('/api/researcher/certificates', requireAuth, wrap((req, res) => res.json(store.myCertificates(req.user.id))));
app.post('/api/researcher/certificates', requireAuth, wrap((req, res) => {
  res.json(store.issueCertificate({ userId: req.user.id, type: (req.body || {}).type }));
}));

// --- Weekly digest: manual trigger (also used by external cron) ---------------
app.post('/api/admin/digest/send', requireAuth, requireDirector, async (req, res) => {
  try {
    res.json(await sendWeeklyDigests(store.digestData(), store.recentFollowedActivity));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Digest failed' });
  }
});

// Full data snapshot for manual backup (Director only).
app.get('/api/admin/export', requireAuth, requireDirector, wrap((_req, res) => {
  res.set('Content-Disposition', 'attachment; filename="synthica-backup.json"');
  res.json(store.exportAll());
}));

// --- Research Groups (interest hubs holding multiple projects) --------------
app.get('/api/groups', requireAuth, wrap((_req, res) => res.json(store.listGroups())));
app.get('/api/groups/:id', requireAuth, wrap((req, res) => res.json(store.groupDetail(req.params.id, req.user.id))));
app.post('/api/groups', requireAuth, wrap((req, res) => res.json(store.createGroup({ userId: req.user.id, ...(req.body || {}) }))));
app.put('/api/groups/:id', requireAuth, wrap((req, res) => res.json(store.updateGroup({ groupId: req.params.id, leaderId: req.user.id, ...(req.body || {}) }))));
app.post('/api/groups/:id/join', requireAuth, wrap((req, res) => res.json(store.joinGroup({ groupId: req.params.id, userId: req.user.id }))));
app.post('/api/groups/:id/leave', requireAuth, wrap((req, res) => res.json(store.leaveGroup({ groupId: req.params.id, userId: req.user.id }))));
app.post('/api/groups/:id/projects', requireAuth, wrap((req, res) => res.json(store.addGroupProject({ groupId: req.params.id, leaderId: req.user.id, projectId: (req.body || {}).projectId }))));
app.delete('/api/groups/:id/projects/:projectId', requireAuth, wrap((req, res) => res.json(store.removeGroupProject({ groupId: req.params.id, leaderId: req.user.id, projectId: req.params.projectId }))));
app.post('/api/groups/:id/positions', requireAuth, wrap((req, res) => res.json(store.addGroupPosition({ groupId: req.params.id, leaderId: req.user.id, ...(req.body || {}) }))));
app.post('/api/groups/:id/positions/:posId', requireAuth, wrap((req, res) => res.json(store.fillGroupPosition({ groupId: req.params.id, leaderId: req.user.id, positionId: req.params.posId, userId: (req.body || {}).userId }))));
app.delete('/api/groups/:id/positions/:posId', requireAuth, wrap((req, res) => res.json(store.removeGroupPosition({ groupId: req.params.id, leaderId: req.user.id, positionId: req.params.posId }))));
app.post('/api/groups/:id/links', requireAuth, wrap((req, res) => res.json(store.addGroupLink({ groupId: req.params.id, leaderId: req.user.id, ...(req.body || {}) }))));
app.delete('/api/groups/:id/links/:linkId', requireAuth, wrap((req, res) => res.json(store.removeGroupLink({ groupId: req.params.id, leaderId: req.user.id, linkId: req.params.linkId }))));

// --- Competitions board -----------------------------------------------------
app.get('/api/competitions', requireAuth, wrap((_req, res) => res.json(store.listCompetitions())));
app.post('/api/competitions', requireAuth, canPostNews, wrap((req, res) => res.json(store.addCompetition({ actor: req.user, ...(req.body || {}) }))));
app.delete('/api/competitions/:id', requireAuth, canPostNews, wrap((req, res) => res.json(store.deleteCompetition({ id: req.params.id, actor: req.user }))));

// --- Global search ----------------------------------------------------------
app.get('/api/search', requireAuth, wrap((req, res) => res.json(store.searchAll(req.query.q, req.user.id))));

// --- Community feed ---------------------------------------------------------
app.get('/api/posts', requireAuth, wrap((req, res) => res.json(store.listPosts(req.user.id))));
app.post('/api/posts', requireAuth, wrap((req, res) => res.json(store.createPost({ userId: req.user.id, ...(req.body || {}) }))));
app.post('/api/posts/:id/like', requireAuth, wrap((req, res) => res.json(store.togglePostLike({ postId: req.params.id, userId: req.user.id }))));
app.post('/api/posts/:id/comments', requireAuth, wrap((req, res) => res.json(store.addPostComment({ postId: req.params.id, userId: req.user.id, text: (req.body || {}).text }))));
app.delete('/api/posts/:id', requireAuth, wrap((req, res) => res.json(store.deletePost({ postId: req.params.id, userId: req.user.id }))));

// --- Direct messages + network ----------------------------------------------
app.get('/api/messages', requireAuth, wrap((req, res) => res.json(store.listConversations(req.user.id))));
app.get('/api/messages/unread', requireAuth, wrap((req, res) => res.json({ count: store.unreadMessageCount(req.user.id) })));
app.get('/api/network', requireAuth, wrap((req, res) => res.json(store.networkFor(req.user.id))));
app.get('/api/messages/:userId', requireAuth, wrap((req, res) => res.json(store.getThread(req.user.id, req.params.userId))));
app.post('/api/messages/:userId', requireAuth, wrap((req, res) => {
  const { text, replyTo, mediaUrl, mediaType } = req.body || {};
  res.json(store.sendMessage({ from: req.user.id, to: req.params.userId, text, replyTo, mediaUrl, mediaType }));
}));
// Edit a message
app.put('/api/messages/:messageId', requireAuth, wrap((req, res) => {
  const { text } = req.body || {};
  res.json(store.editMessage(req.user.id, req.params.messageId, text));
}));
// Delete a message
app.delete('/api/messages/:messageId', requireAuth, wrap((req, res) => {
  res.json(store.deleteMessage(req.user.id, req.params.messageId));
}));
// Toggle reaction on a message
app.post('/api/messages/:messageId/react', requireAuth, wrap((req, res) => {
  const { emoji } = req.body || {};
  if (!emoji) return res.status(400).json({ error: 'Emoji is required' });
  res.json(store.toggleReaction(req.user.id, req.params.messageId, emoji));
}));
// Forward a message
app.post('/api/messages/:messageId/forward', requireAuth, wrap((req, res) => {
  const { toUserId } = req.body || {};
  if (!toUserId) return res.status(400).json({ error: 'Recipient is required' });
  res.json(store.forwardMessage(req.user.id, req.params.messageId, toUserId));
}));
// Get users for forwarding
app.get('/api/messages/forward-targets', requireAuth, wrap((req, res) => {
  res.json(store.getForwardTargets(req.user.id));
}));

// --- Trust & safety: report, block, account export/delete ------------------
app.post('/api/report', requireAuth, wrap((req, res) => {
  const { kind, targetId, reason } = req.body || {};
  res.json(store.reportContent({ reporterId: req.user.id, kind, targetId, reason }));
}));
app.get('/api/me/blocks', requireAuth, wrap((req, res) => res.json(store.listBlocked(req.user.id))));
app.post('/api/users/:id/block', requireAuth, wrap((req, res) => res.json(store.blockUser(req.user.id, req.params.id))));
app.delete('/api/users/:id/block', requireAuth, wrap((req, res) => res.json(store.unblockUser(req.user.id, req.params.id))));
app.get('/api/me/export', requireAuth, wrap((req, res) => res.json(store.exportMyData(req.user.id))));
app.delete('/api/me', requireAuth, wrap((req, res) => res.json(store.deleteMyAccount(req.user.id))));

// --- Real-time stream (Server-Sent Events) ---------------------------------
// The browser opens an EventSource with ?token=… (EventSource can't set headers).
app.get('/api/stream', (req, res) => {
  const user = userFromToken(req.query.token);
  if (!user) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: {}\n\n`);
  const unsub = store.subscribeRealtime((targetId, type, data) => {
    if (targetId !== user.id) return;
    try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  });
  // Heartbeat keeps proxies from closing the idle connection.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 25000);
  req.on('close', () => { clearInterval(ping); unsub(); });
});

// --- Referrals --------------------------------------------------------------
app.get('/api/me/referrals', requireAuth, wrap((req, res) => res.json(store.myReferralStats(req.user.id))));
app.get('/api/admin/referrals', requireAuth, requireAuditor, wrap((_req, res) => res.json(store.referralLeaderboard())));

// --- Admin: member moderation, suspension, broadcast ------------------------
const escHtml = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

app.post('/api/admin/users/:id/suspend', requireAuth, requireDirector, wrap((req, res) => {
  res.json(store.setUserSuspended({ userId: req.params.id, suspended: !!(req.body || {}).suspended, actor: req.user }));
}));

app.post('/api/admin/users/:id/send-reset', requireAuth, requireDirector, wrap((req, res) => {
  const u = store.getUserById(req.params.id);
  if (!u || !u.email) return res.status(404).json({ error: 'That member has no email on file' });
  const rt = issuePurposeToken(u.id, 'reset', 60 * 60);
  actionEmail({
    to: u.email, subject: 'Reset your Synthica password', heading: 'Password reset',
    intro: `Hi ${String(u.name || 'there').split(' ')[0]},`,
    blocks: ['An administrator started a password reset for your account. Click below to choose a new password (link expires in an hour).'],
    button: { label: 'Reset password', url: `${FRONTEND_URL || ''}/reset?token=${rt}` }, signoff: 'Stay secure,',
  });
  res.json({ ok: true });
}));

// Branded email broadcast to a member segment (director only).
app.post('/api/admin/broadcast', requireAuth, requireDirector, async (req, res) => {
  try {
    const { subject, heading, body, audience, to } = req.body || {};
    if (!subject?.trim() || !body?.trim()) return res.status(400).json({ error: 'A subject and message are required' });
    
    let recipients;
    if (to && to.trim()) {
      // Custom email recipient(s) - supports comma-separated emails
      const emails = to.split(',').map(e => e.trim()).filter(e => e && e.includes('@'));
      if (emails.length === 0) return res.status(400).json({ error: 'At least one valid email is required' });
      recipients = emails.map(email => ({ email }));
    } else {
      recipients = store.broadcastRecipients(audience);
    }
    
    const blocks = String(body).split(/\n{2,}/).map((p) => escHtml(p).replace(/\n/g, '<br>'));
    for (const r of recipients) {
      actionEmail({ to: r.email, subject: subject.trim(), heading: (heading || subject).trim(), intro: `Hi ${String(r.name || 'there').split(' ')[0]},`, blocks, signoff: 'Thanks,' });
    }
    res.json({ sent: recipients.length, audience: to ? 'custom' : (audience || 'all') });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Broadcast failed' });
  }
});

// --- In-app notifications --------------------------------------------------
app.get('/api/notifications', requireAuth, wrap((req, res) => res.json(store.listNotifications(req.user.id))));
app.post('/api/notifications/read', requireAuth, wrap((req, res) => {
  res.json(store.markNotificationsRead(req.user.id, (req.body || {}).ids));
}));

// --- Global news / announcements -------------------------------------------
app.get('/api/news', requireAuth, wrap((_req, res) => res.json(store.listNews())));
app.post('/api/news', requireAuth, canPostNews, wrap((req, res) => {
  const { title, body, audience } = req.body || {};
  res.json(store.addNews({ authorId: req.user.id, authorName: req.user.name, title, body, audience }));
}));

// Public self-registration (researchers). Requires email + Discord.
app.post('/api/register', authLimiter, wrap((req, res) => {
  const { name, email, discord, password, username, resumeUrl, ref } = req.body || {};
  const user = store.registerResearcher({ name, email, discord, password, username, resumeUrl, ref });
  // Branded welcome email with a verification link (logged if no provider).
  const vt = issuePurposeToken(user.id, 'verify', 60 * 60 * 24);
  const { subject, html, text } = welcomeEmail({ name: user.name, verifyUrl: `${FRONTEND_URL || ''}/verify?token=${vt}`, communityUrl: `${FRONTEND_URL || ''}/researcher/community` });
  sendEmail({ to: user.email, subject, html, text });
  res.json({ token: issueToken(user), user });
}));

// Email verification.
app.post('/api/auth/verify-email', wrap((req, res) => {
  const id = verifyPurposeToken((req.body || {}).token, 'verify');
  if (!id || !store.markEmailVerified(id)) return res.status(400).json({ error: 'Invalid or expired link' });
  res.json({ ok: true });
}));

app.post('/api/auth/resend-verification', authLimiter, requireAuth, wrap((req, res) => {
  const vt = issuePurposeToken(req.user.id, 'verify', 60 * 60 * 24);
  actionEmail({ to: req.user.email, subject: 'Confirm your Synthica email', heading: 'Confirm your email', intro: `Hi ${req.user.name?.split(' ')[0] || 'there'},`, blocks: ['Click below to confirm your email address and secure your account.'], button: { label: 'Confirm email', url: `${FRONTEND_URL || ''}/verify?token=${vt}` } });
  res.json({ ok: true });
}));

// Password reset (always responds ok so it doesn't leak which emails exist).
app.post('/api/auth/forgot-password', authLimiter, wrap((req, res) => {
  const user = store.getUserByEmail((req.body || {}).email || '');
  if (user && user.password) {
    const rt = issuePurposeToken(user.id, 'reset', 60 * 60);
    actionEmail({ to: user.email, subject: 'Reset your Synthica password', heading: 'Reset your password', intro: `Hi ${user.name?.split(' ')[0] || 'there'},`, blocks: ['We received a request to reset your password. Click below to choose a new one — this link expires in an hour. If you didn’t ask for this, you can ignore this email.'], button: { label: 'Reset password', url: `${FRONTEND_URL || ''}/reset?token=${rt}` }, signoff: 'Stay secure,' });
  }
  res.json({ ok: true });
}));

app.post('/api/auth/reset-password', authLimiter, wrap((req, res) => {
  const { token, password } = req.body || {};
  const id = verifyPurposeToken(token, 'reset');
  if (!id) return res.status(400).json({ error: 'Invalid or expired link' });
  store.setPassword(id, password);
  res.json({ ok: true });
}));

// --- Track 2: Journal publications / DOI registry --------------------------
app.get('/api/journal/publications', wrap((req, res) => {
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  let pubs = store.listPublications();
  const { category, q } = req.query;
  if (category) pubs = pubs.filter((p) => p.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    pubs = pubs.filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        p.authors.some((a) => a.name.toLowerCase().includes(needle))
    );
  }
  res.json(pubs);
}));

// RSS feed of the latest publications.
app.get('/api/journal/rss', wrap((_req, res) => {
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  const pubs = store.listPublications()
    .slice()
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const items = pubs.map((p) => `
    <item>
      <title>${esc(p.title)}</title>
      <link>https://doi.org/${esc(p.doi)}</link>
      <guid isPermaLink="false">${esc(p.doi)}</guid>
      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>
      <category>${esc(p.category)}</category>
      <description>${esc(p.abstract)}</description>
    </item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Synthica Journal</title>
  <link>https://www.synthica.org/journal-archive.html</link>
  <description>Latest open-access research from the Synthica Journal.</description>
  ${items}
</channel></rss>`;
  res.set('Content-Type', 'application/rss+xml').send(xml);
}));

app.get('/api/journal/publications/:id', wrap((req, res) => {
  const pub = store.getPublication(req.params.id);
  if (!pub) return res.status(404).json({ error: 'Publication not found' });
  // Ready-to-copy citations ride along so article pages can offer "Cite this".
  res.json({ ...pub, citation: citationFormats(pub) });
}));

// Journal home + volumes/issues browse (public, lightly cached at the edge/browser).
const publicCache = (res) => res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
app.get('/api/journal/overview', wrap((_req, res) => { publicCache(res); res.json(store.journalOverview()); }));
app.get('/api/journal/volumes', wrap((_req, res) => { publicCache(res); res.json(store.listVolumes()); }));
app.get('/api/journal/competitions', wrap((_req, res) => { publicCache(res); res.json(store.listCompetitions()); }));
app.get('/api/journal/issue/:volume/:issue', wrap((req, res) => { publicCache(res); res.json(store.issueContents(req.params.volume, req.params.issue)); }));

// Journal masthead + issue lifecycle (public: the standalone journal site and
// indexers read these; issues are first-class records with an open/closed state).
app.get('/api/journal/meta', wrap((_req, res) => { publicCache(res); res.json(store.journalMeta()); }));
app.get('/api/journal/issues', wrap((_req, res) => { publicCache(res); res.json(store.listJournalIssues()); }));
app.get('/api/journal/issues/:volume/:issue', wrap((req, res) => {
  publicCache(res);
  const detail = store.journalIssueDetail(req.params.volume, req.params.issue);
  if (!detail) return res.status(404).json({ error: 'Issue not found' });
  res.json(detail);
}));

// Full article page (hero) — public; if a token is present we resolve the viewer
// so an author/staff sees the "tag accounts" controls.
app.get('/api/journal/article/:id', wrap((req, res) => {
  const header = req.headers.authorization || '';
  const viewer = userFromToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  const view = store.articleView(req.params.id, viewer?.id || null);
  if (!view) return res.status(404).json({ error: 'Article not found' });
  res.json(view);
}));

// Tag / untag Synthica accounts on a publication (authors of the paper or staff).
app.post('/api/journal/publications/:id/tags', requireAuth, wrap((req, res) => {
  const { addUserIds, removeUserIds } = req.body || {};
  res.json(store.tagPublicationAccounts({ pubId: req.params.id, actorId: req.user.id, addUserIds, removeUserIds }));
}));

// Cross-link a preprint to its published article (author of either side / staff).
app.post('/api/journal/publications/:id/link-preprint', requireAuth, wrap((req, res) => {
  res.json(store.linkPreprintToPublication({ pubId: req.params.id, preprintId: (req.body || {}).preprintId, actorId: req.user.id }));
}));

// --- Preprint server (author-posted, versioned, internal Synthica IDs) ------
app.get('/api/preprints', wrap((req, res) => { res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120'); res.json(store.listPreprints({ category: req.query.category, q: req.query.q })); }));
app.get('/api/researcher/preprints', requireAuth, wrap((req, res) => res.json(store.myPreprints(req.user.id))));
app.post('/api/preprints', requireAuth, wrap((req, res) => res.json(store.postPreprint({ userId: req.user.id, ...(req.body || {}) }))));
app.get('/api/preprints/:id', wrap((req, res) => {
  const header = req.headers.authorization || '';
  const viewer = userFromToken(header.startsWith('Bearer ') ? header.slice(7) : null);
  const view = store.preprintView(req.params.id, viewer?.id || null);
  if (!view) return res.status(404).json({ error: 'Preprint not found' });
  res.json(view);
}));
app.post('/api/preprints/:id/versions', requireAuth, wrap((req, res) => {
  const { pdfUrl, note } = req.body || {};
  res.json(store.addPreprintVersion({ preprintId: req.params.id, userId: req.user.id, pdfUrl, note }));
}));
app.post('/api/preprints/:id/access', wrap((req, res) => {
  const n = store.recordPreprintAccess(req.params.id);
  if (n === null) return res.status(404).json({ error: 'Preprint not found' });
  res.json({ ok: true, accesses: n });
}));
app.post('/api/preprints/:id/tags', requireAuth, wrap((req, res) => {
  const { addUserIds, removeUserIds } = req.body || {};
  res.json(store.tagPreprintAccounts({ preprintId: req.params.id, actorId: req.user.id, addUserIds, removeUserIds }));
}));

app.post('/api/journal/publications/:id/access', wrap((req, res) => {
  const accesses = store.recordPublicationAccess(req.params.id);
  if (accesses === null) return res.status(404).json({ error: 'Publication not found' });
  res.json({ ok: true, accesses });
}));

// Per-paper OG share card (1200×630 PNG) + a share page whose meta tags
// crawlers can read (the static site can't serve per-paper tags).
app.get('/api/journal/publications/:id/og.png', wrap((req, res) => {
  const pub = store.getPublication(req.params.id);
  if (!pub) return res.status(404).json({ error: 'Publication not found' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(ogCardPng(pub));
}));

app.get('/api/journal/publications/:id/share', wrap((req, res) => {
  const pub = store.getPublication(req.params.id);
  if (!pub) return res.status(404).json({ error: 'Publication not found' });
  const apiBase = `${req.protocol}://${req.get('host')}`;
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(sharePageHtml(pub, { apiBase, siteBase: SITE_URL }));
}));

// --- Track 3: Editor dashboard ---------------------------------------------
// All editor routes require auth and act as the logged-in editor.
const editorOnly = (req, res, next) =>
  req.user.kind === 'editor' || req.user.allViewsDemo ? next() : res.status(403).json({ error: 'Editors only' });

app.get('/api/editor/papers', requireAuth, editorOnly, wrap((req, res) => {
  res.json(store.papersForEditor(req.user.id));
}));

app.post('/api/editor/papers/:id/review', requireAuth, editorOnly, wrap((req, res) => {
  const { decision, comments, recommendation } = req.body || {};
  res.json(
    store.submitReviewDecision({ paperId: req.params.id, editorId: req.user.id, decision, comments, recommendation })
  );
}));

app.post('/api/editor/papers/:id/senior', requireAuth, editorOnly, wrap((req, res) => {
  const { decision, comments } = req.body || {};
  res.json(store.seniorDecision({ paperId: req.params.id, editorId: req.user.id, decision, comments }));
}));

app.post('/api/editor/papers/:id/associate-round', requireAuth, editorOnly, wrap((req, res) => {
  const { note } = req.body || {};
  res.json(store.associateRound({ paperId: req.params.id, editorId: req.user.id, note }));
}));

app.get('/api/editor/stats', requireAuth, editorOnly, wrap((req, res) => {
  res.json(store.editorStats(req.user.id));
}));

// Internal editor comment thread on a paper.
app.post('/api/editor/papers/:id/comments', requireAuth, editorOnly, wrap((req, res) => {
  const { body } = req.body || {};
  res.json(store.addPaperComment({ paperId: req.params.id, editorId: req.user.id, body }));
}));

// An editor asks the author for a revision.
app.post('/api/editor/papers/:id/request-revision', requireAuth, editorOnly, wrap((req, res) => {
  const { note } = req.body || {};
  res.json(store.requestRevision({ paperId: req.params.id, editorId: req.user.id, note }));
}));

app.post('/api/editor/papers/:id/chief', requireAuth, editorOnly, wrap((req, res) => {
  if (req.user.role !== EDITOR_ROLES.CHIEF) return res.status(403).json({ error: 'Editor-in-chief only' });
  const { decision, comments } = req.body || {};
  res.json(store.chiefDecision({ paperId: req.params.id, editorId: req.user.id, decision, comments }));
}));

// Director-only views + actions (the platform Admin sees these too).
const directorOnly = (req, res, next) =>
  [EDITOR_ROLES.DIRECTOR, EDITOR_ROLES.ADMIN].includes(req.user.role) ? next() : res.status(403).json({ error: 'Director only' });

app.get('/api/editor/director', requireAuth, editorOnly, directorOnly, wrap((_req, res) => {
  res.json(store.directorView());
}));

app.post('/api/editor/director/emailed', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const { paperId, at } = req.body || {};
  store.markEmailed({ paperId, at });
  res.json({ ok: true });
}));

app.post('/api/editor/director/publish', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const { paperId, doiSuffix, volume, issue, pages } = req.body || {};
  res.json(store.publishToJournal({ paperId, doiSuffix, volume, issue, pages }));
}));

// Issue lifecycle: close the open issue (stamps its date, opens the next one)
// and re-file a published article into another existing issue.
app.post('/api/editor/director/issues/close', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const { editorial, at } = req.body || {};
  res.json(store.closeOpenIssue({ editorial, at }));
}));

app.post('/api/editor/director/issues/move', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const { publicationId, volume, issue } = req.body || {};
  res.json(store.moveArticleToIssue({ publicationId, volume, issue }));
}));

// Crossref journal deposit XML for one issue — the Director downloads this file
// and uploads it at doi.crossref.org so the issue's DOIs resolve publicly.
app.get('/api/editor/director/crossref.xml', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const volume = Number(req.query.volume), issue = Number(req.query.issue);
  if (!volume || !issue) return res.status(400).json({ error: 'volume and issue query params are required' });
  const rec = store.getJournalIssue(volume, issue);
  if (!rec) return res.status(404).json({ error: 'Issue not found' });
  const articles = store.listPublications().filter((p) => (p.volume || 1) === volume && (p.issue || 1) === issue);
  res.set('Content-Type', 'application/xml');
  res.set('Content-Disposition', `attachment; filename="synthica-crossref-v${volume}-i${issue}.xml"`);
  res.send(crossrefBatchXml({ issue: rec, articles }));
}));

app.get('/api/editor/director/workload', requireAuth, editorOnly, directorOnly, wrap((_req, res) => {
  res.json(store.editorWorkload());
}));

// Review-stage papers + swap candidates that power the reassignment panel.
app.get('/api/editor/director/reassign', requireAuth, editorOnly, directorOnly, wrap((_req, res) => {
  res.json(store.directorReassignBoard());
}));

app.post('/api/editor/director/reassign', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const { paperId, fromEditorId, toEditorId } = req.body || {};
  res.json(store.reassignReviewer({ paperId, fromEditorId, toEditorId }));
}));

// Director: configure + test the Discord webhook for queue notifications.
app.get('/api/editor/settings', requireAuth, editorOnly, directorOnly, wrap((_req, res) => {
  res.json({ discordWebhookUrl: notify.getWebhook(), whatsappWebhookUrl: notify.getWhatsapp() });
}));

app.put('/api/editor/settings', requireAuth, editorOnly, directorOnly, wrap((req, res) => {
  const { discordWebhookUrl, whatsappWebhookUrl } = req.body || {};
  if (discordWebhookUrl && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(discordWebhookUrl)) {
    return res.status(400).json({ error: 'That does not look like a Discord webhook URL' });
  }
  if (whatsappWebhookUrl && !/^https:\/\//.test(whatsappWebhookUrl)) {
    return res.status(400).json({ error: 'WhatsApp webhook must be an https URL' });
  }
  if (discordWebhookUrl !== undefined) notify.setWebhook(discordWebhookUrl);
  if (whatsappWebhookUrl !== undefined) notify.setWhatsapp(whatsappWebhookUrl);
  res.json({ discordWebhookUrl: notify.getWebhook(), whatsappWebhookUrl: notify.getWhatsapp() });
}));

app.post('/api/editor/settings/test', requireAuth, editorOnly, directorOnly, wrap(async (_req, res) => {
  const result = await notify.sendTest();
  if (result.skipped) return res.status(400).json({ error: 'Set a webhook URL first' });
  res.json(result);
}));

// --- Track 4: Researcher dashboard -----------------------------------------
const researcherOnly = (req, res, next) => {
  if (req.user.kind !== 'researcher' && !req.user.allViewsDemo) {
    return res.status(403).json({ error: 'Researchers only' });
  }
  next();
};

app.get('/api/researcher/projects', requireAuth, researcherOnly, wrap((req, res) => {
  // Projects the user is a member of (associate view) or leads (lead view).
  const mine = store.listProjects().filter((p) => p.members.includes(req.user.id));
  res.json(mine);
}));

app.get('/api/researcher/projects/:id', requireAuth, researcherOnly, wrap((req, res) => {
  const project = store.getProject(req.params.id);
  if (!project || !project.members.includes(req.user.id))
    return res.status(404).json({ error: 'Project not found' });
  // Resolve members to full contacts (name, email, discord) for the roster +
  // the lead's "email everyone" action.
  const team = store.projectTeam(project.id);
  const memberNames = team.map((m) => m.name);
  res.json({ ...project, team, memberNames, isLead: project.leadId === req.user.id });
}));

// Researcher updates the link to their résumé.
app.put('/api/researcher/me/resume', requireAuth, researcherOnly, wrap((req, res) => {
  const { resumeUrl } = req.body || {};
  res.json(store.updateResume(req.user.id, resumeUrl));
}));

app.get('/api/researcher/hub/listings', requireAuth, researcherOnly, wrap((_req, res) => {
  res.json(store.listListings());
}));

app.post('/api/researcher/hub/apply', requireAuth, researcherOnly, wrap((req, res) => {
  const { listingId, role, message, answers } = req.body || {};
  // Auto-attach the applicant's résumé link (if they've added one).
  res.json(store.addApplication({
    userId: req.user.id,
    userName: req.user.name,
    listingId: listingId || null,
    role: role || null,
    message: message || '',
    answers: answers && typeof answers === 'object' ? answers : null,
    resumeUrl: req.user.resumeUrl || '',
  }));
}));

app.get('/api/researcher/applications', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.listApplications().filter((a) => a.userId === req.user.id));
}));

// Leads: create listings/projects + review applicants to their own listings.
app.get('/api/researcher/my-listings', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.myListings(req.user.id));
}));

app.put('/api/researcher/listings/:id', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, spots, description, bannerUrl, lookingFor, customApplication, customQuestions } = req.body || {};
  res.json(store.updateListing({ listingId: req.params.id, leadId: req.user.id, title, category, spots, description, bannerUrl, lookingFor, customApplication, customQuestions }));
}));

app.delete('/api/researcher/listings/:id', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deleteListing({ listingId: req.params.id, leadId: req.user.id }));
}));

app.post('/api/researcher/listings', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, spots, description, bannerUrl, lookingFor, projectId, customApplication, customQuestions } = req.body || {};
  res.json(store.createListing({ userId: req.user.id, title, category, spots, description, bannerUrl, lookingFor, projectId, customApplication, customQuestions }));
}));

// --- Shared calendar: lead/staff deadlines + due dates ----------------------
app.get('/api/calendar', requireAuth, wrap((req, res) => res.json(store.calendarFor(req.user.id))));

app.post('/api/events', requireAuth, wrap((req, res) => {
  const { title, type, dueAt, projectId, chapterId, groupId } = req.body || {};
  res.json(store.addEvent({ userId: req.user.id, title, type, dueAt, projectId, chapterId, groupId }));
}));

app.post('/api/events/:id/rsvp', requireAuth, wrap((req, res) => {
  res.json(store.rsvpEvent({ eventId: req.params.id, userId: req.user.id, going: !!(req.body || {}).going }));
}));

app.delete('/api/events/:id', requireAuth, wrap((req, res) => {
  res.json(store.deleteEvent({ id: req.params.id, userId: req.user.id }));
}));
app.post('/api/researcher/projects', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, description, spots, customApplication, customQuestions, publishListing } = req.body || {};
  res.json(store.createProject({ userId: req.user.id, title, category, description, spots, customApplication, customQuestions, publishListing }));
}));
app.get('/api/researcher/listing-applications', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.myListingApplications(req.user.id));
}));
app.post('/api/researcher/listing-applications/:id', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.reviewListingApplication({ leadId: req.user.id, appId: req.params.id, status: (req.body || {}).status }));
}));
// Researcher submits a paper into the editor pipeline + manages revisions.
app.post('/api/researcher/journal/submit', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, abstract, pdfUrl, coAuthors } = req.body || {};
  res.json(store.submitToJournal({ userId: req.user.id, title, category, abstract, pdfUrl, coAuthors }));
}));

app.get('/api/researcher/my-submissions', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.mySubmissions(req.user.id));
}));

app.post('/api/researcher/submissions/:id/revise', requireAuth, researcherOnly, wrap((req, res) => {
  const { url, note } = req.body || {};
  res.json(store.addRevision({ paperId: req.params.id, userId: req.user.id, url, note }));
}));

// Researcher self-archives a past paper (links to their profile, pending verify)
// and lists their own publications (verified + pending).
app.get('/api/researcher/publications', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.myPublications(req.user.id));
}));

app.post('/api/researcher/publications', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.addPastPaper(req.user.id, req.body || {}));
}));

// Any member can add a task; the lead approves tasks that need sign-off.
app.post('/api/researcher/projects/:id/tasks', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, type, dueAt, assignedTo, requiresApproval } = req.body || {};
  res.json(store.addProjectTask({ projectId: req.params.id, userId: req.user.id, title, type, dueAt, assignedTo, requiresApproval }));
}));

app.post('/api/researcher/projects/:id/tasks/:taskId/assign', requireAuth, researcherOnly, wrap((req, res) => {
  const { memberId } = req.body || {};
  res.json(store.assignTask({ projectId: req.params.id, userId: req.user.id, taskId: req.params.taskId, memberId }));
}));

app.post('/api/researcher/projects/:id/tasks/:taskId/start', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.startTask({ projectId: req.params.id, userId: req.user.id, taskId: req.params.taskId }));
}));

app.post('/api/researcher/projects/:id/tasks/:taskId/approve', requireAuth, researcherOnly, wrap((req, res) => {
  const { approve } = req.body || {};
  res.json(store.approveTask({ projectId: req.params.id, userId: req.user.id, taskId: req.params.taskId, approve: approve !== false }));
}));

app.post('/api/researcher/projects/:id/tasks/:taskId/complete', requireAuth, researcherOnly, wrap((req, res) => {
  const { done } = req.body || {};
  res.json(store.completeTask({ projectId: req.params.id, userId: req.user.id, taskId: req.params.taskId, done: done !== false }));
}));

app.post('/api/researcher/projects/:id/announcements', requireAuth, researcherOnly, wrap((req, res) => {
  const { body } = req.body || {};
  res.json(store.addProjectAnnouncement({ projectId: req.params.id, userId: req.user.id, body }));
}));

// Any member can link a paper / media resource (rendered as an embed preview).
app.post('/api/researcher/projects/:id/invite', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.inviteToProject({ projectId: req.params.id, leadId: req.user.id, email: (req.body || {}).email }));
}));

app.post('/api/researcher/projects/:id/links', requireAuth, researcherOnly, wrap((req, res) => {
  const { label, url } = req.body || {};
  res.json(store.addProjectLink({ projectId: req.params.id, userId: req.user.id, label, url }));
}));

app.delete('/api/researcher/projects/:id/links/:linkId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deleteProjectLink({ projectId: req.params.id, linkId: req.params.linkId, userId: req.user.id }));
}));

// Lead assigns a member's role (auto-shown on their profile) + suggested people.
app.post('/api/researcher/projects/:id/roles', requireAuth, researcherOnly, wrap((req, res) => {
  const { userId, title } = req.body || {};
  res.json(store.setProjectRole({ projectId: req.params.id, leadId: req.user.id, userId, title }));
}));

app.get('/api/researcher/projects/:id/suggested', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.suggestedPeopleForProject(req.params.id, req.user.id));
}));

app.post('/api/researcher/projects/:id/invite-member', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.inviteToProjectById({ projectId: req.params.id, leadId: req.user.id, userId: (req.body || {}).userId }));
}));

app.get('/api/researcher/projects/:id/stats', requireAuth, researcherOnly, wrap((req, res) => {
  const project = store.getProject(req.params.id);
  if (!project || !project.members.includes(req.user.id))
    return res.status(404).json({ error: 'Project not found' });
  res.json(store.projectStats(req.params.id));
}));

// Project-scoped calendar: this project's deadlines + dated task due-dates.
app.get('/api/researcher/projects/:id/events', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.projectEvents(req.params.id, req.user.id));
}));

// ============================================================
// SANDBOX PROJECTS (Independent Researcher personal projects)
// ============================================================
app.get('/api/researcher/sandbox', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.listSandboxProjects(req.user.id));
}));

app.get('/api/researcher/sandbox/:projectId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.getSandboxProject(req.user.id, req.params.projectId));
}));

app.post('/api/researcher/sandbox', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, description } = req.body || {};
  res.json(store.createSandboxProject({ userId: req.user.id, title, category, description }));
}));

app.put('/api/researcher/sandbox/:projectId', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, description } = req.body || {};
  res.json(store.updateSandboxProject(req.user.id, req.params.projectId, { title, category, description }));
}));

app.delete('/api/researcher/sandbox/:projectId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deleteSandboxProject(req.user.id, req.params.projectId));
}));

// Sandbox tasks
app.post('/api/researcher/sandbox/:projectId/tasks', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, description, priority, dueDate } = req.body || {};
  res.json(store.addSandboxTask(req.user.id, req.params.projectId, { title, description, priority, dueDate }));
}));

app.put('/api/researcher/sandbox/:projectId/tasks/:taskId', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, description, priority, dueDate, status } = req.body || {};
  res.json(store.updateSandboxTask(req.user.id, req.params.projectId, req.params.taskId, { title, description, priority, dueDate, status }));
}));

app.delete('/api/researcher/sandbox/:projectId/tasks/:taskId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deleteSandboxTask(req.user.id, req.params.projectId, req.params.taskId));
}));

// Sandbox notes
app.post('/api/researcher/sandbox/:projectId/notes', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, content } = req.body || {};
  res.json(store.addSandboxNote(req.user.id, req.params.projectId, { title, content }));
}));

app.put('/api/researcher/sandbox/:projectId/notes/:noteId', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, content } = req.body || {};
  res.json(store.updateSandboxNote(req.user.id, req.params.projectId, req.params.noteId, { title, content }));
}));

app.delete('/api/researcher/sandbox/:projectId/notes/:noteId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deleteSandboxNote(req.user.id, req.params.projectId, req.params.noteId));
}));

// Sandbox documents
app.post('/api/researcher/sandbox/:projectId/documents', requireAuth, researcherOnly, wrap((req, res) => {
  const { name, type, url, size } = req.body || {};
  res.json(store.addSandboxDocument(req.user.id, req.params.projectId, { name, type, url, size }));
}));

app.delete('/api/researcher/sandbox/:projectId/documents/:docId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deleteSandboxDocument(req.user.id, req.params.projectId, req.params.docId));
}));

// Sandbox Google Drive sync
app.post('/api/researcher/sandbox/:projectId/sync-drive', requireAuth, researcherOnly, wrap((req, res) => {
  const project = store.getSandboxProject(req.user.id, req.params.projectId);
  // Return project data for client to sync with Drive
  res.json({ project, needsSync: true });
}));

app.put('/api/researcher/sandbox/:projectId/drive-folder', requireAuth, researcherOnly, wrap((req, res) => {
  const { folderId } = req.body || {};
  res.json(store.setSandboxDriveFolder(req.user.id, req.params.projectId, folderId));
}));

// Project idea board (brainstorm + vote; lead chooses).
app.post('/api/researcher/projects/:id/ideas', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.addIdea({ projectId: req.params.id, userId: req.user.id, text: (req.body || {}).text }));
}));
app.post('/api/researcher/projects/:id/ideas/:ideaId/vote', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.voteIdea({ projectId: req.params.id, userId: req.user.id, ideaId: req.params.ideaId }));
}));
app.post('/api/researcher/projects/:id/ideas/:ideaId/choose', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.chooseIdea({ projectId: req.params.id, userId: req.user.id, ideaId: req.params.ideaId }));
}));

// Independent research proposals — submit, list mine, revise & resubmit.
app.get('/api/researcher/proposals', requireAuth, researcherOnly, wrap((req, res) => res.json(store.listProposalsForUser(req.user.id))));
app.post('/api/researcher/proposals', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, description, methodology } = req.body || {};
  res.json(store.addProposal({ userId: req.user.id, title, category, description, methodology }));
}));
app.post('/api/researcher/proposals/:id/revise', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, category, description, methodology } = req.body || {};
  res.json(store.reviseProposal({ id: req.params.id, userId: req.user.id, title, category, description, methodology }));
}));

// Pathway — personal guided research to-dos.
app.get('/api/researcher/pathway', requireAuth, researcherOnly, wrap((req, res) => res.json(store.listPathway(req.user.id))));
app.post('/api/researcher/pathway', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, deliverable, dueAt } = req.body || {};
  res.json(store.addPathway({ userId: req.user.id, title, deliverable, dueAt }));
}));
app.post('/api/researcher/pathway/seed', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.seedPathway({ userId: req.user.id, track: (req.body || {}).track }));
}));
app.post('/api/researcher/pathway/:id/toggle', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.togglePathway({ userId: req.user.id, itemId: req.params.id, done: (req.body || {}).done }));
}));
app.delete('/api/researcher/pathway/:id', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.deletePathway({ userId: req.user.id, itemId: req.params.id }));
}));

// Follow / people directory / personalized feed (any authed user).
app.get('/api/people', requireAuth, wrap((req, res) => res.json(store.peopleDirectory(req.user.id))));
app.post('/api/people/:id/follow', requireAuth, wrap((req, res) => res.json(store.followUser(req.user.id, req.params.id))));
app.post('/api/people/:id/unfollow', requireAuth, wrap((req, res) => res.json(store.unfollowUser(req.user.id, req.params.id))));
app.get('/api/feed', requireAuth, wrap((req, res) => res.json(store.feedFor(req.user.id))));

// Onboarding (current researcher).
app.post('/api/researcher/roles/associate', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.claimAssociateRole(req.user.id));
}));

app.get('/api/researcher/onboarding', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.myOnboarding(req.user.id));
}));

app.post('/api/researcher/onboarding/step', requireAuth, researcherOnly, wrap((req, res) => {
  const { key, done } = req.body || {};
  res.json(store.setOnboardingStep({ userId: req.user.id, key, done }));
}));

// A rejected sign-up edits their profile and asks for another review. Uses
// requireAuth (not researcherOnly) because the member isn't approved yet.
app.post('/api/researcher/onboarding/resubmit', requireAuth, wrap((req, res) => {
  if (req.user.kind !== 'researcher') return res.status(403).json({ error: 'Researchers only' });
  res.json(store.resubmitOnboarding(req.user.id));
}));

// Chapter leader: roster + stats, and onboarding new members.
app.get('/api/researcher/chapter', requireAuth, researcherOnly, wrap((req, res) => {
  const view = store.chapterView(req.user.id);
  res.json(view || { hasChapter: false, isLeader: false });
}));

app.post('/api/researcher/chapter', requireAuth, researcherOnly, wrap((req, res) => {
  const { name, location, handbookUrl } = req.body || {};
  res.json(store.createChapter({ leaderId: req.user.id, name, location, handbookUrl }));
}));

app.post('/api/researcher/chapter/members', requireAuth, researcherOnly, wrap((req, res) => {
  const { name, email, discord } = req.body || {};
  res.json(store.addChapterMember({ leaderId: req.user.id, name, email, discord }));
}));

app.post('/api/researcher/chapter/announcements', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, body } = req.body || {};
  res.json(store.addChapterAnnouncement({ leaderId: req.user.id, title, body }));
}));

// Member joins a private chapter by entering its 8-character code.
app.post('/api/researcher/chapter/join', requireAuth, researcherOnly, wrap((req, res) => {
  const { code } = req.body || {};
  res.json(store.joinChapterByCode({ userId: req.user.id, code }));
}));

// Leader rotates their chapter's join code.
app.post('/api/researcher/chapter/regenerate-code', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.regenerateJoinCode(req.user.id));
}));

app.post('/api/researcher/chapter/progress', requireAuth, researcherOnly, wrap((req, res) => {
  const { title, description, type } = req.body || {};
  res.json(store.addChapterProgress({ leaderId: req.user.id, title, description, type }));
}));

app.get('/api/researcher/chapter/progress', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.getChapterProgress(req.user.id));
}));

// --- Expertise mentors (ROLE_WORKFLOWS §7) ---------------------------------
// Directory + booking (any researcher) and mentor self-service (mentor tag).
app.get('/api/mentors', requireAuth, researcherOnly, wrap((req, res) => res.json(store.listMentors({ specialty: req.query.specialty }))));
app.get('/api/mentors/specialties', requireAuth, researcherOnly, wrap((_req, res) => res.json(store.mentorSpecialties())));
app.get('/api/mentors/:id', requireAuth, researcherOnly, wrap((req, res) => res.json(store.getMentor(req.params.id))));
app.post('/api/mentors/:id/book', requireAuth, researcherOnly, wrap((req, res) => {
  const { slot, note } = req.body || {};
  res.json(store.bookMentor({ researcherId: req.user.id, mentorId: req.params.id, slot, note }));
}));
app.get('/api/me/mentor-bookings', requireAuth, researcherOnly, wrap((req, res) => res.json(store.myMentorBookings(req.user.id))));

// Mentor's own dashboard: profile, availability, bookings.
app.get('/api/mentor/dashboard', requireAuth, researcherOnly, wrap((req, res) => res.json(store.mentorDashboard(req.user.id))));
app.put('/api/mentor/profile', requireAuth, researcherOnly, wrap((req, res) => {
  const { specialties, mentorBio } = req.body || {};
  res.json(store.setMentorProfile({ userId: req.user.id, specialties, mentorBio }));
}));
app.post('/api/mentor/availability', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.addMentorSlot({ userId: req.user.id, slot: (req.body || {}).slot }));
}));
app.delete('/api/mentor/availability/:slotId', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.removeMentorSlot({ userId: req.user.id, slotId: req.params.slotId }));
}));
app.post('/api/mentor/calendar-connect', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.setMentorCalendarConnected({ userId: req.user.id, connected: (req.body || {}).connected }));
}));
// Either party cancels a booking.
app.post('/api/mentor-bookings/:id/cancel', requireAuth, researcherOnly, wrap((req, res) => {
  res.json(store.cancelMentorBooking({ userId: req.user.id, bookingId: req.params.id }));
}));

// Reload baseline data (seed, or the spreadsheet when on Sheets). Destructive
// on the memory provider — Director/Admin only, never anonymous.
app.post('/api/dev/reset', requireAuth, requireDirector, async (_req, res) => {
  try {
    await store.reset();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;

// Load the active data provider (memory or Google Sheets) before serving.
store
  .init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Synthica backend running on http://localhost:${PORT}`);
    });
    // Weekly digest scheduler (opt-in; needs an always-on instance). Hosts
    // that sleep should hit POST /api/admin/digest/send from a cron instead.
    if (process.env.ENABLE_DIGESTS === 'true') {
      setInterval(() => maybeSendWeekly(store.digestData, store.recentFollowedActivity).catch((e) => console.error('[digest]', e.message)), 60 * 60 * 1000);
      console.log('[digest] weekly digest scheduler enabled (Mondays 13:00 UTC)');
    }
  })
  .catch((err) => {
    console.error('Failed to initialize data store:', err.message);
    process.exit(1);
  });
