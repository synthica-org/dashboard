import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Icon from './Icon.jsx';

const RESEARCHER_TAGS = new Set([
  'associate_researcher',
  'lead_researcher',
  'chapter_leader',
  'independent_researcher',
]);

const ROLES = [
  {
    tag: 'associate_researcher',
    title: 'Associate Researcher',
    icon: 'users',
    description: 'Join a team, contribute to projects, and learn alongside other researchers.',
    instant: true,
  },
  {
    tag: 'lead_researcher',
    title: 'Lead Researcher',
    icon: 'rocket',
    description: 'Run your own project and recruit a team. We review your background and research plan.',
    applyRole: 'Lead Researcher',
  },
  {
    tag: 'chapter_leader',
    title: 'Chapter Leader',
    icon: 'globe',
    description: 'Start and lead a local Synthica chapter in your area.',
    applyRole: 'Chapter Leader',
  },
  {
    tag: 'independent_researcher',
    title: 'Independent Researcher',
    icon: 'flask',
    description: 'Pursue your own research agenda with Synthica support and community.',
    applyRole: 'Independent Researcher',
  },
];

export function shouldShowRolePicker(user) {
  if (!user || user.kind !== 'researcher') return false;
  if (!user.onboarded || user.rolesIntroSeen) return false;
  return !(user.tags || []).some((t) => RESEARCHER_TAGS.has(t));
}

/** Shown after onboarding — pick a role or apply for advanced ones. */
export default function RolePicker() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  if (!shouldShowRolePicker(user)) return null;

  const dismiss = async () => {
    setBusy('later');
    try {
      await api.updateProfile({ rolesIntroSeen: true });
      await refreshUser();
    } finally {
      setBusy('');
    }
  };

  const joinAssociate = async () => {
    setError('');
    setBusy('associate');
    try {
      await api.claimAssociateRole();
      await refreshUser();
    } catch (e) {
      setError(e.message || 'Could not join as Associate');
    } finally {
      setBusy('');
    }
  };

  const applyFor = async (applyRole) => {
    setBusy(applyRole);
    try {
      await api.updateProfile({ rolesIntroSeen: true });
      await refreshUser();
      navigate(`/researcher/apply?role=${encodeURIComponent(applyRole)}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="ob-overlay role-picker-overlay">
      <div className="ob-card role-picker-card">
        <h2 className="role-picker-title">Choose your path</h2>
        <p className="role-picker-sub">
          Pick how you want to participate at Synthica. You can add more roles later.
        </p>
        {error && <div className="login-error">{error}</div>}

        <div className="role-picker-grid">
          {ROLES.map((r) => (
            <div key={r.tag} className={`role-picker-item ${r.instant ? 'role-picker-item-instant' : ''}`}>
              <span className="role-picker-ico" aria-hidden="true"><Icon name={r.icon} size={22} /></span>
              <div className="role-picker-body">
                <strong>{r.title}</strong>
                <p>{r.description}</p>
              </div>
              {r.instant ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!!busy}
                  onClick={joinAssociate}
                >
                  {busy === 'associate' ? 'Joining…' : 'Yes, join'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!!busy}
                  onClick={() => applyFor(r.applyRole)}
                >
                  {busy === r.applyRole ? '…' : 'Apply'}
                </button>
              )}
            </div>
          ))}
        </div>

        <button type="button" className="link-btn role-picker-skip" disabled={!!busy} onClick={dismiss}>
          {busy === 'later' ? '…' : 'Decide later'}
        </button>
      </div>
    </div>
  );
}
