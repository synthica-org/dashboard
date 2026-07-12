import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Profile from './Profile.jsx';
import Tools from './Tools.jsx';
import { Security } from './Tools.jsx';
import Certificates from '../components/Certificates.jsx';
import Referrals from '../components/Referrals.jsx';
import PrivacySafety from '../components/PrivacySafety.jsx';
import { useAuth } from '../auth.jsx';

// The account center — one place to manage everything tied to "you": your public
// profile, résumé & tools, role certificates, referrals, privacy, and security.
// Each section is a focused sub-page; the segmented control up top makes the
// available areas obvious at a glance. The active tab is mirrored to ?tab= so a
// link can deep-link straight to (say) Security or Certificates.
export default function Account() {
  const { user } = useAuth();
  const isResearcher = user?.kind === 'researcher';
  const [params, setParams] = useSearchParams();

  // Tabs are gated by account kind: only researchers earn role certificates.
  const tabs = [
    ['profile', 'Profile', () => <Profile />],
    ['tools', 'Résumé & tools', () => <Tools />],
    isResearcher && ['certs', 'Certificates', () => <Certificates />],
    ['referrals', 'Refer & invite', () => <Referrals />],
    ['privacy', 'Privacy & safety', () => <PrivacySafety />],
    ['security', 'Security', () => <Security />],
  ].filter(Boolean);

  const requested = params.get('tab');
  const valid = tabs.some(([key]) => key === requested);
  const [fallback, setFallback] = useState('profile');
  const tab = valid ? requested : fallback;

  const select = (key) => {
    setFallback(key);
    // replace: switching tabs shouldn't pile up browser-history entries.
    setParams(key === 'profile' ? {} : { tab: key }, { replace: true });
  };

  const Active = (tabs.find(([key]) => key === tab) || tabs[0])[2];

  return (
    <div>
      <h1 className="page-title">Account</h1>
      <p className="page-sub">Manage your profile, certificates, privacy, and security — all in one place.</p>
      <div className="seg" style={{ marginBottom: '1.25rem' }} role="tablist" aria-label="Account sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`seg-btn ${tab === key ? 'active' : ''}`}
            onClick={() => select(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  );
}
