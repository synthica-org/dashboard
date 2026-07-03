// Thin fetch wrapper around the backend API. Reads the auth token from
// localStorage and attaches it as a Bearer header.

const TOKEN_KEY = 'synthica.token';

// Where the backend lives. In dev this is empty, so requests hit "/api/…" and
// Vite's proxy forwards them to localhost:4000. In production, set
// VITE_API_BASE (e.g. https://synthica-backend.onrender.com) at build time.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export const apiBase = API_BASE;

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, { method = 'GET', body } = {}, attempt = 0) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // Reads retry through transient failures (free-tier backends cold-start and
  // briefly answer 502/503, or the connection drops) so a click loads without
  // a manual refresh. Writes are never retried (not idempotent).
  const retryable = method === 'GET' && attempt < 3;

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (retryable) {
      await sleep(1500 * 2 ** attempt); // 1.5s, 3s, 6s
      return request(path, { method, body }, attempt + 1);
    }
    throw new Error('Can’t reach the server — it may be waking up. Try again in a few seconds.');
  }

  if ([502, 503, 504].includes(res.status) && retryable) {
    await sleep(1500 * 2 ** attempt);
    return request(path, { method, body }, attempt + 1);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Expired/invalid session: every call would silently fail until a manual
    // refresh. Clear the token and send them to login instead.
    if (res.status === 401 && token && !path.startsWith('/login') && !path.startsWith('/2fa')) {
      clearToken();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login?expired=1');
        return new Promise(() => {}); // page is navigating away
      }
    }
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status; // callers can feature-detect (e.g. 404 = endpoint not deployed)
    throw err;
  }
  return data;
}

export const api = {
  // file upload (multipart — can't go through request()'s JSON helper)
  upload: async (file, kind = 'image') => {
    const fd = new FormData();
    fd.append('file', file);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/uploads?kind=${encodeURIComponent(kind)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data; // { url, name, size }
  },
  // auth
  login: (identifier, password) => request('/login', { method: 'POST', body: { identifier, password } }),
  checkEmail: (email) => request('/auth/check-email', { method: 'POST', body: { email } }),
  verify2fa: (tempToken, code) => request('/2fa/verify', { method: 'POST', body: { tempToken, code } }),
  setup2fa: () => request('/2fa/setup', { method: 'POST' }),
  enable2fa: (code) => request('/2fa/enable', { method: 'POST', body: { code } }),
  disable2fa: (code) => request('/2fa/disable', { method: 'POST', body: { code } }),
  register: (body) => request('/register', { method: 'POST', body }),
  googleAuth: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
  config: () => request('/config'),
  me: () => request('/me'),
  updateProfile: (body) => request('/me/profile', { method: 'PUT', body }),
  profile: (id) => request(`/profiles/${id}`),
  // admin (director / auditor)
  adminAnalytics: () => request('/admin/analytics'),
  adminApplications: () => request('/admin/applications'),
  reviewApplication: (id, status, assignTag, feedback) => request(`/admin/applications/${id}`, { method: 'POST', body: { status, assignTag, feedback } }),
  adminSetTags: (id, body) => request(`/admin/users/${id}/tags`, { method: 'POST', body }),
  adminUsers: (q) => request(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminSetRole: (id, body) => request(`/admin/users/${id}/role`, { method: 'POST', body }),
  adminSuspend: (id, suspended) => request(`/admin/users/${id}/suspend`, { method: 'POST', body: { suspended } }),
  adminSendReset: (id) => request(`/admin/users/${id}/send-reset`, { method: 'POST' }),
  adminBroadcast: (body) => request('/admin/broadcast', { method: 'POST', body }),
  adminBulkRole: (body) => request('/admin/bulk-role', { method: 'POST', body }),
  adminAudit: () => request('/admin/audit'),
  adminExport: () => request('/admin/export'),
  // paper archive (admin upload + self-archive verification)
  adminPublications: () => request('/admin/publications'),
  adminAddPublication: (body) => request('/admin/publications', { method: 'POST', body }),
  adminDeletePublication: (id) => request(`/admin/publications/${id}`, { method: 'DELETE' }),
  adminArchiveQueue: () => request('/admin/archive-queue'),
  verifyPublication: (id, status) => request(`/admin/publications/${id}/verify`, { method: 'POST', body: { status } }),
  // Independent project proposals (Unit 6). The Moderator console feature-detects
  // these — if the backend doesn't expose the endpoints yet it falls back to a
  // "coming soon" state instead of erroring.
  adminProposals: () => request('/admin/proposals'),
  reviewProposal: (id, status, feedback) => request(`/admin/proposals/${id}`, { method: 'POST', body: { status, feedback } }),
  adminEditPublication: (id, body) => request(`/admin/publications/${id}`, { method: 'PUT', body }),
  featurePublication: (id, featured) => request(`/admin/publications/${id}/feature`, { method: 'POST', body: { featured } }),
  setSettings: (body) => request('/editor/settings', { method: 'PUT', body }),
  // news + account
  news: () => request('/news'),
  postNews: (body) => request('/news', { method: 'POST', body }),
  notifications: () => request('/notifications'),
  markNotificationsRead: (ids) => request('/notifications/read', { method: 'POST', body: { ids } }),
  profiles: () => request('/profiles'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => request('/auth/reset-password', { method: 'POST', body: { token, password } }),
  verifyEmail: (token) => request('/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),

  // Track 2 — journal
  publications: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/journal/publications${qs ? `?${qs}` : ''}`);
  },
  recordPublicationAccess: (id) => request(`/journal/publications/${encodeURIComponent(id)}/access`, { method: 'POST' }),
  article: (id) => request(`/journal/article/${encodeURIComponent(id)}`),
  journalOverview: () => request('/journal/overview'),
  // Journal site metadata ({ journalUrl, … }). Optional endpoint — callers
  // feature-detect it and quietly hide journal links when it 404s.
  journalMeta: () => request('/journal/meta'),
  journalVolumes: () => request('/journal/volumes'),
  journalCompetitions: () => request('/journal/competitions'),
  journalIssue: (v, i) => request(`/journal/issue/${encodeURIComponent(v)}/${encodeURIComponent(i)}`),
  // preprints
  preprints: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/preprints${qs ? `?${qs}` : ''}`); },
  preprint: (id) => request(`/preprints/${encodeURIComponent(id)}`),
  myPreprints: () => request('/researcher/preprints'),
  postPreprint: (body) => request('/preprints', { method: 'POST', body }),
  addPreprintVersion: (id, body) => request(`/preprints/${encodeURIComponent(id)}/versions`, { method: 'POST', body }),
  recordPreprintAccess: (id) => request(`/preprints/${encodeURIComponent(id)}/access`, { method: 'POST' }),
  tagPreprint: (id, body) => request(`/preprints/${encodeURIComponent(id)}/tags`, { method: 'POST', body }),
  tagPublication: (id, body) => request(`/journal/publications/${encodeURIComponent(id)}/tags`, { method: 'POST', body }),
  linkPreprint: (pubId, preprintId) => request(`/journal/publications/${encodeURIComponent(pubId)}/link-preprint`, { method: 'POST', body: { preprintId } }),

  // Track 3 — editor
  editorPapers: () => request('/editor/papers'),
  review: (id, body) => request(`/editor/papers/${id}/review`, { method: 'POST', body }),
  senior: (id, body) => request(`/editor/papers/${id}/senior`, { method: 'POST', body }),
  associateRound: (id, body) => request(`/editor/papers/${id}/associate-round`, { method: 'POST', body }),
  chief: (id, body) => request(`/editor/papers/${id}/chief`, { method: 'POST', body }),
  director: () => request('/editor/director'),
  markEmailed: (body) => request('/editor/director/emailed', { method: 'POST', body }),
  publish: (body) => request('/editor/director/publish', { method: 'POST', body }),
  addComment: (id, body) => request(`/editor/papers/${id}/comments`, { method: 'POST', body: { body } }),
  workload: () => request('/editor/director/workload'),
  reassignBoard: () => request('/editor/director/reassign'),
  reassign: (body) => request('/editor/director/reassign', { method: 'POST', body }),

  // Track 4 — researcher
  myProjects: () => request('/researcher/projects'),
  project: (id) => request(`/researcher/projects/${id}`),
  listings: () => request('/researcher/hub/listings'),
  apply: (body) => request('/researcher/hub/apply', { method: 'POST', body }),
  myApplications: () => request('/researcher/applications'),
  createListing: (body) => request('/researcher/listings', { method: 'POST', body }),
  myListings: () => request('/researcher/my-listings'),
  updateListing: (id, body) => request(`/researcher/listings/${id}`, { method: 'PUT', body }),
  deleteListing: (id) => request(`/researcher/listings/${id}`, { method: 'DELETE' }),
  createProject: (body) => request('/researcher/projects', { method: 'POST', body }),
  listingApplications: () => request('/researcher/listing-applications'),
  reviewListingApplication: (id, status) => request(`/researcher/listing-applications/${id}`, { method: 'POST', body: { status } }),
  addTask: (id, body) => request(`/researcher/projects/${id}/tasks`, { method: 'POST', body }),
  assignTask: (id, taskId, memberId) => request(`/researcher/projects/${id}/tasks/${taskId}/assign`, { method: 'POST', body: { memberId } }),
  startTask: (id, taskId) => request(`/researcher/projects/${id}/tasks/${taskId}/start`, { method: 'POST' }),
  approveTask: (id, taskId, approve) => request(`/researcher/projects/${id}/tasks/${taskId}/approve`, { method: 'POST', body: { approve } }),
  completeTask: (id, taskId, done) => request(`/researcher/projects/${id}/tasks/${taskId}/complete`, { method: 'POST', body: { done } }),
  addAnnouncement: (id, body) => request(`/researcher/projects/${id}/announcements`, { method: 'POST', body }),
  addProjectLink: (id, body) => request(`/researcher/projects/${id}/links`, { method: 'POST', body }),
  deleteProjectLink: (id, linkId) => request(`/researcher/projects/${id}/links/${linkId}`, { method: 'DELETE' }),
  inviteToProject: (id, email) => request(`/researcher/projects/${id}/invite`, { method: 'POST', body: { email } }),
  inviteMemberById: (id, userId) => request(`/researcher/projects/${id}/invite-member`, { method: 'POST', body: { userId } }),
  setProjectRole: (id, userId, title) => request(`/researcher/projects/${id}/roles`, { method: 'POST', body: { userId, title } }),
  suggestedForProject: (id) => request(`/researcher/projects/${id}/suggested`),
  projectStats: (id) => request(`/researcher/projects/${id}/stats`),
  projectEvents: (id) => request(`/researcher/projects/${id}/events`),
  addIdea: (id, text) => request(`/researcher/projects/${id}/ideas`, { method: 'POST', body: { text } }),
  voteIdea: (id, ideaId) => request(`/researcher/projects/${id}/ideas/${ideaId}/vote`, { method: 'POST' }),
  chooseIdea: (id, ideaId) => request(`/researcher/projects/${id}/ideas/${ideaId}/choose`, { method: 'POST' }),
  
  // Sandbox (Independent Researcher personal projects)
  sandboxList: () => request('/researcher/sandbox'),
  sandboxProject: (id) => request(`/researcher/sandbox/${id}`),
  sandboxCreate: (body) => request('/researcher/sandbox', { method: 'POST', body }),
  sandboxUpdate: (id, body) => request(`/researcher/sandbox/${id}`, { method: 'PUT', body }),
  sandboxDelete: (id) => request(`/researcher/sandbox/${id}`, { method: 'DELETE' }),
  sandboxAddTask: (id, body) => request(`/researcher/sandbox/${id}/tasks`, { method: 'POST', body }),
  sandboxUpdateTask: (id, taskId, body) => request(`/researcher/sandbox/${id}/tasks/${taskId}`, { method: 'PUT', body }),
  sandboxDeleteTask: (id, taskId) => request(`/researcher/sandbox/${id}/tasks/${taskId}`, { method: 'DELETE' }),
  sandboxAddNote: (id, body) => request(`/researcher/sandbox/${id}/notes`, { method: 'POST', body }),
  sandboxUpdateNote: (id, noteId, body) => request(`/researcher/sandbox/${id}/notes/${noteId}`, { method: 'PUT', body }),
  sandboxDeleteNote: (id, noteId) => request(`/researcher/sandbox/${id}/notes/${noteId}`, { method: 'DELETE' }),
  sandboxAddDoc: (id, body) => request(`/researcher/sandbox/${id}/documents`, { method: 'POST', body }),
  sandboxDeleteDoc: (id, docId) => request(`/researcher/sandbox/${id}/documents/${docId}`, { method: 'DELETE' }),
  sandboxSyncDrive: (id) => request(`/researcher/sandbox/${id}/sync-drive`, { method: 'POST' }),
  sandboxSetDriveFolder: (id, folderId) => request(`/researcher/sandbox/${id}/drive-folder`, { method: 'PUT', body: { folderId } }),
  
  calendar: () => request('/calendar'),
  addEvent: (body) => request('/events', { method: 'POST', body }),
  rsvpEvent: (id, going) => request(`/events/${id}/rsvp`, { method: 'POST', body: { going } }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),
  myStats: () => request('/me/stats'),
  // research groups
  groups: () => request('/groups'),
  group: (id) => request(`/groups/${id}`),
  createGroup: (body) => request('/groups', { method: 'POST', body }),
  updateGroup: (id, body) => request(`/groups/${id}`, { method: 'PUT', body }),
  joinGroup: (id) => request(`/groups/${id}/join`, { method: 'POST' }),
  leaveGroup: (id) => request(`/groups/${id}/leave`, { method: 'POST' }),
  addGroupProject: (id, projectId) => request(`/groups/${id}/projects`, { method: 'POST', body: { projectId } }),
  removeGroupProject: (id, projectId) => request(`/groups/${id}/projects/${projectId}`, { method: 'DELETE' }),
  addGroupPosition: (id, body) => request(`/groups/${id}/positions`, { method: 'POST', body }),
  fillGroupPosition: (id, posId, userId) => request(`/groups/${id}/positions/${posId}`, { method: 'POST', body: { userId } }),
  removeGroupPosition: (id, posId) => request(`/groups/${id}/positions/${posId}`, { method: 'DELETE' }),
  addGroupLink: (id, body) => request(`/groups/${id}/links`, { method: 'POST', body }),
  removeGroupLink: (id, linkId) => request(`/groups/${id}/links/${linkId}`, { method: 'DELETE' }),
  // competitions
  competitions: () => request('/competitions'),
  addCompetition: (body) => request('/competitions', { method: 'POST', body }),
  deleteCompetition: (id) => request(`/competitions/${id}`, { method: 'DELETE' }),
  // search
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  // community feed
  posts: () => request('/posts'),
  createPost: (body) => request('/posts', { method: 'POST', body }),
  likePost: (id) => request(`/posts/${id}/like`, { method: 'POST' }),
  commentPost: (id, text) => request(`/posts/${id}/comments`, { method: 'POST', body: { text } }),
  deletePost: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  // direct messages + network
  conversations: () => request('/messages'),
  unreadMessages: () => request('/messages/unread'),
  thread: (userId) => request(`/messages/${userId}`),
  sendMessage: (userId, text, opts = {}) => request(`/messages/${userId}`, { method: 'POST', body: { text, ...opts } }),
  editMessage: (messageId, text) => request(`/messages/${messageId}`, { method: 'PUT', body: { text } }),
  deleteMessage: (messageId) => request(`/messages/${messageId}`, { method: 'DELETE' }),
  toggleReaction: (messageId, emoji) => request(`/messages/${messageId}/react`, { method: 'POST', body: { emoji } }),
  forwardMessage: (messageId, toUserId) => request(`/messages/${messageId}/forward`, { method: 'POST', body: { toUserId } }),
  forwardTargets: () => request('/messages/forward-targets'),
  network: () => request('/network'),
  // trust & safety
  report: (kind, targetId, reason) => request('/report', { method: 'POST', body: { kind, targetId, reason } }),
  blockUser: (id) => request(`/users/${id}/block`, { method: 'POST' }),
  unblockUser: (id) => request(`/users/${id}/block`, { method: 'DELETE' }),
  myBlocks: () => request('/me/blocks'),
  exportMyData: () => request('/me/export'),
  deleteMyAccount: () => request('/me', { method: 'DELETE' }),
  adminReports: (status = 'open') => request(`/admin/reports?status=${encodeURIComponent(status)}`),
  resolveReport: (id, action) => request(`/admin/reports/${id}/resolve`, { method: 'POST', body: { action } }),
  // referrals
  myReferrals: () => request('/me/referrals'),
  referralLeaderboard: () => request('/admin/referrals'),
  pathway: () => request('/researcher/pathway'),
  addPathway: (body) => request('/researcher/pathway', { method: 'POST', body }),
  seedPathway: (track) => request('/researcher/pathway/seed', { method: 'POST', body: { track } }),
  togglePathway: (id, done) => request(`/researcher/pathway/${id}/toggle`, { method: 'POST', body: { done } }),
  deletePathway: (id) => request(`/researcher/pathway/${id}`, { method: 'DELETE' }),
  // independent research proposals (submit → Moderator approval → project)
  myProposals: () => request('/researcher/proposals'),
  submitProposal: (body) => request('/researcher/proposals', { method: 'POST', body }),
  reviseProposal: (id, body) => request(`/researcher/proposals/${id}/revise`, { method: 'POST', body }),
  adminProposals: () => request('/admin/proposals'),
  reviewProposal: (id, status, feedback) => request(`/admin/proposals/${id}`, { method: 'POST', body: { status, feedback } }),
  people: () => request('/people'),
  follow: (id) => request(`/people/${id}/follow`, { method: 'POST' }),
  unfollow: (id) => request(`/people/${id}/unfollow`, { method: 'POST' }),
  feed: () => request('/feed'),
  updateResume: (resumeUrl) => request('/researcher/me/resume', { method: 'PUT', body: { resumeUrl } }),
  submitJournal: (body) => request('/researcher/journal/submit', { method: 'POST', body }),
  mySubmissions: () => request('/researcher/my-submissions'),
  reviseSubmission: (id, body) => request(`/researcher/submissions/${id}/revise`, { method: 'POST', body }),
  myPublications: () => request('/researcher/publications'),
  addPastPaper: (body) => request('/researcher/publications', { method: 'POST', body }),
  requestRevision: (id, note) => request(`/editor/papers/${id}/request-revision`, { method: 'POST', body: { note } }),
  onboarding: () => request('/researcher/onboarding'),
  onboardingStep: (key, done) => request('/researcher/onboarding/step', { method: 'POST', body: { key, done } }),
  claimAssociateRole: () => request('/researcher/roles/associate', { method: 'POST' }),
  resubmitOnboarding: () => request('/researcher/onboarding/resubmit', { method: 'POST' }),
  chapter: () => request('/researcher/chapter'),
  createChapter: (body) => request('/researcher/chapter', { method: 'POST', body }),
  addChapterMember: (body) => request('/researcher/chapter/members', { method: 'POST', body }),
  chapterAnnounce: (body) => request('/researcher/chapter/announcements', { method: 'POST', body }),
  joinChapterByCode: (code) => request('/researcher/chapter/join', { method: 'POST', body: { code } }),
  regenerateChapterCode: () => request('/researcher/chapter/regenerate-code', { method: 'POST' }),
  chapterProgress: () => request('/researcher/chapter/progress'),
  addChapterProgress: (body) => request('/researcher/chapter/progress', { method: 'POST', body }),
  // programs (apply → cohort → milestones)
  programs: () => request('/researcher/programs'),
  applyProgram: (id, message) => request(`/researcher/programs/${id}/apply`, { method: 'POST', body: { message } }),
  adminPrograms: () => request('/admin/programs'),
  createProgram: (body) => request('/admin/programs', { method: 'POST', body }),
  setProgramStatus: (id, status) => request(`/admin/programs/${id}/status`, { method: 'POST', body: { status } }),
  addProgramMilestone: (id, body) => request(`/admin/programs/${id}/milestones`, { method: 'POST', body }),
  toggleProgramMilestone: (id, mid, done) => request(`/admin/programs/${id}/milestones/${mid}`, { method: 'POST', body: { done } }),
  reviewProgramApplication: (id, status) => request(`/admin/program-applications/${id}`, { method: 'POST', body: { status } }),
  // certificates
  myCertificates: () => request('/researcher/certificates'),
  issueCertificate: (type) => request('/researcher/certificates', { method: 'POST', body: { type } }),
  verifyCertificate: (code) => request(`/certificates/${encodeURIComponent(code)}`),
  // weekly digest (admin)
  sendDigest: () => request('/admin/digest/send', { method: 'POST' }),
  // editor
  editorStats: () => request('/editor/stats'),
  getSettings: () => request('/editor/settings'),
  setWebhook: (discordWebhookUrl) => request('/editor/settings', { method: 'PUT', body: { discordWebhookUrl } }),
  testWebhook: () => request('/editor/settings/test', { method: 'POST' }),

  // Expertise mentors (ROLE_WORKFLOWS §7)
  // Directory + booking (any researcher):
  mentors: (specialty) => request(`/mentors${specialty ? `?specialty=${encodeURIComponent(specialty)}` : ''}`),
  mentorSpecialties: () => request('/mentors/specialties'),
  mentor: (id) => request(`/mentors/${id}`),
  bookMentor: (id, body) => request(`/mentors/${id}/book`, { method: 'POST', body }),
  myMentorBookings: () => request('/me/mentor-bookings'),
  cancelMentorBooking: (id) => request(`/mentor-bookings/${id}/cancel`, { method: 'POST' }),
  // Mentor self-service (mentor's own dashboard):
  mentorDashboard: () => request('/mentor/dashboard'),
  setMentorProfile: (body) => request('/mentor/profile', { method: 'PUT', body }),
  mentorAvailability: () => request('/mentor/dashboard'),
  setMentorAvailability: (body) => request('/mentor/availability', { method: 'POST', body }),
  removeMentorSlot: (slotId) => request(`/mentor/availability/${slotId}`, { method: 'DELETE' }),
  connectMentorCalendar: (connected) => request('/mentor/calendar-connect', { method: 'POST', body: { connected } }),

  // Journal issue lifecycle (Director desk). These endpoints ship with the
  // backend issue-lifecycle unit — the Director desk feature-detects their
  // absence and quietly hides issue management until they exist.
  journalMeta: () => request('/journal/meta'),
  journalIssues: () => request('/journal/issues'),
  journalIssueDetail: (volume, issue) => request(`/journal/issues/${encodeURIComponent(volume)}/${encodeURIComponent(issue)}`),
  closeCurrentIssue: () => request('/editor/director/issues/close', { method: 'POST' }),
  moveArticleToIssue: (body) => request('/editor/director/issues/move', { method: 'POST', body }),
  // Crossref deposit XML for one issue. Raw fetch (not request()) because the
  // response is an XML file, not JSON — and the Bearer header still has to go
  // along, so a plain <a href> download won't do.
  directorCrossrefXml: async ({ volume, issue }) => {
    const token = getToken();
    const qs = new URLSearchParams({ volume, issue }).toString();
    const res = await fetch(`${API_BASE}/api/editor/director/crossref.xml?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      // Same expired-session handling as request(): don't leave the user
      // toasting 401s against a dead token.
      if (res.status === 401 && token) {
        clearToken();
        window.location.assign('/login?expired=1');
        return new Promise(() => {}); // page is navigating away
      }
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || `Download failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return res.blob();
  },
};
