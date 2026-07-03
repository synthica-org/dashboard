import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import EditorDashboard, { QUEUE_COUNT_EVENT } from './EditorDashboard.jsx';
import DirectorDashboard from './DirectorDashboard.jsx';
import Admin from './Admin.jsx';
import Email from './Email.jsx';
import Tools from '../Tools.jsx';
import Profile from '../Profile.jsx';
import Account from '../Account.jsx';

// Each editor tier gets a queue labelled for its job (see JOURNAL_PIPELINE §9).
const QUEUE_NAV = {
  reviews: { label: 'Review queue', icon: 'search' },
  senior: { label: 'Senior queue', icon: 'shield' },
  associate: { label: 'Author rounds', icon: 'pen' },
  chief: { label: 'Sign-off queue', icon: 'check-circle' },
};

// Editors share one shell. Auditors get the Admin view (no review queue);
// Directors get Director Desk + Admin; the platform Admin sees everything;
// everyone else gets their tier's review queue.
export default function EditorApp() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'admin';
  const isDirector = user?.role === 'director' || isSuperAdmin;
  const isAuditor = user?.role === 'auditor';
  const isAdmin = isDirector || isAuditor;
  // Auditors and the platform Admin have no personal review queue.
  const hasQueue = !isAuditor && !isSuperAdmin;
  const queue = QUEUE_NAV[user?.role] || { label: 'My queue', icon: 'inbox' };
  const { pathname } = useLocation();
  const [queueCount, setQueueCount] = useState(0);

  // Nav badge: how many papers sit in this editor's queue. While the queue
  // page is mounted, EditorDashboard broadcasts fresh counts (its poll + every
  // decision) — listen for those.
  useEffect(() => {
    if (!hasQueue) return undefined;
    const onCount = (e) => setQueueCount(e.detail ?? 0);
    window.addEventListener(QUEUE_COUNT_EVENT, onCount);
    return () => window.removeEventListener(QUEUE_COUNT_EVENT, onCount);
  }, [hasQueue]);

  // Elsewhere, one light fetch per route change keeps the badge current
  // ('/editor' is skipped — the dashboard's own fetch covers it). No polling.
  useEffect(() => {
    if (!hasQueue || pathname === '/editor') return undefined;
    let on = true;
    api.editorPapers().then((d) => { if (on) setQueueCount(d.inbox?.length ?? 0); }).catch(() => {});
    return () => { on = false; };
  }, [hasQueue, pathname]);

  const nav = [];
  if (hasQueue) nav.push({ to: '/editor', label: queue.label, icon: queue.icon, end: true, badge: queueCount });
  if (isDirector) nav.push({ to: '/editor/director', label: 'Director Desk', icon: 'folder-open' });
  if (isAdmin) nav.push({ to: '/editor/admin', label: 'Admin', icon: 'settings' });
  nav.push({ to: '/editor/email', label: 'Send Email', icon: 'mail' });
  nav.push({ to: '/archive', label: 'Archive', icon: 'archive' });
  nav.push({ to: '/editor/account', label: 'Account', icon: 'user' });

  return (
    <Layout nav={nav}>
      <Routes>
        <Route index element={hasQueue ? <EditorDashboard /> : <Navigate to={isSuperAdmin ? '/editor/director' : '/editor/admin'} replace />} />
        {isDirector && <Route path="director" element={<DirectorDashboard />} />}
        {isAdmin && <Route path="admin" element={<Admin />} />}
        <Route path="email" element={<Email />} />
        <Route path="account" element={<Account />} />
        <Route path="profile" element={<Profile />} />
        <Route path="tools" element={<Tools />} />
        <Route path="*" element={<Navigate to="/editor" replace />} />
      </Routes>
    </Layout>
  );
}
