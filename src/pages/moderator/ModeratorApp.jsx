import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from '../../components/Layout.jsx';
import { useAuth } from '../../auth.jsx';
import ModeratorConsole from './ModeratorConsole.jsx';
import Account from '../Account.jsx';
import Profile from '../Profile.jsx';

// Dedicated Moderator (platform Auditor) console. Auditors land here by default;
// Directors/Admins can also open it. Backend gating lives on the `requireAuditor`
// routes the console calls — this shell guards the UI and lays out the nav.
export default function ModeratorApp() {
  const { user } = useAuth();
  const allowed = ['auditor', 'director', 'admin'].includes(user?.role);

  // A signed-in editor account without moderator powers shouldn't see the desk.
  if (!allowed) return <Navigate to="/" replace />;

  const nav = [
    { to: '/moderator', label: 'Moderator desk', icon: 'shield', end: true },
    { to: '/archive', label: 'Archive', icon: 'archive' },
    { spacer: true },
    { to: '/moderator/account', label: 'Account', icon: 'user' },
  ];

  return (
    <Layout nav={nav}>
      <Routes>
        <Route index element={<ModeratorConsole />} />
        <Route path="account" element={<Account />} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/moderator" replace />} />
      </Routes>
    </Layout>
  );
}
