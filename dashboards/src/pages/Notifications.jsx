import { useState, Component } from 'react';
import { Card, Button, Badge } from '../components/ui.jsx';
import Toggle from '../components/Toggle.jsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/toast.jsx';

// Error boundary to catch rendering errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('Notifications Error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <h3 style={{ color: 'var(--danger)' }}>Error loading notifications</h3>
          <p style={{ color: 'var(--body-alt)' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>Reload page</button>
        </Card>
      );
    }
    return this.props.children;
  }
}

const DISCORD_SERVER_LINK = 'https://discord.com/invite/8wPzZkGy5Z';

const NOTIFICATION_TYPES = [
  { key: 'comment', label: 'Comments on your posts', desc: 'When someone comments on your posts' },
  { key: 'project', label: 'Project updates', desc: 'When you are added to or removed from projects' },
  { key: 'project_invite', label: 'Project invitations', desc: 'When you receive a project invitation' },
  { key: 'application_update', label: 'Application updates', desc: 'Status updates on your applications' },
  { key: 'mentor_request', label: 'Mentor requests', desc: 'When someone requests your mentorship' },
  { key: 'announcement', label: 'Announcements', desc: 'Community announcements and updates' },
  { key: 'role_granted', label: 'Role assignments', desc: 'When you are assigned a new role' },
  { key: 'proposal_update', label: 'Proposal updates', desc: 'Status updates on your proposals' },
  { key: 'listing_update', label: 'Listing updates', desc: 'Updates on listings you have applied to' },
];

function NotificationsContent() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  
  // Guard: show loading if no user
  if (!user) {
    return (
      <Card>
        <p style={{ color: 'var(--body-alt)', textAlign: 'center', padding: '2rem' }}>
          Loading notification settings...
        </p>
      </Card>
    );
  }
  
  const [discord, setDiscord] = useState(user?.discord || '');
  const [savingDiscord, setSavingDiscord] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Initialize notification preferences from user data
  const emailPrefs = user?.notifications?.email || {};
  const discordPrefs = user?.notifications?.discord || {};

  const [emailEnabled, setEmailEnabled] = useState(() => 
    NOTIFICATION_TYPES.reduce((acc, t) => {
      acc[t.key] = emailPrefs[t.key] !== undefined ? emailPrefs[t.key] : true;
      return acc;
    }, {})
  );

  const [discordEnabled, setDiscordEnabled] = useState(() =>
    NOTIFICATION_TYPES.reduce((acc, t) => {
      acc[t.key] = discordPrefs[t.key] ?? true; // Default to true
      return acc;
    }, {})
  );

  const handleDiscordSave = async () => {
    setSavingDiscord(true);
    try {
      await api.updateProfile({ discord: discord.trim() });
      await refreshUser();
      toast.success('Discord username saved');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingDiscord(false);
    }
  };

  const [sendingTest, setSendingTest] = useState(false);
  const handleSendTestDM = async () => {
    if (!user?.discord) return toast.error('No Discord username set');
    setSendingTest(true);
    try {
      const data = await api.notifyTest();
      toast.success('Test DM sent! Check your Discord.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSendingTest(false);
    }
  };

  const handleToggleEmail = (key) => {
    setEmailEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleDiscord = (key) => {
    setDiscordEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSavePreferences = async () => {
    setSavingPrefs(true);
    try {
      const notifications = {
        email: emailEnabled,
        discord: discordEnabled,
      };
      await api.updateProfile({ notifications });
      await refreshUser();
      toast.success('Notification preferences saved');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSavingPrefs(false);
    }
  };

  // Check if Discord is connected
  const hasDiscord = user?.discord && user.discord.trim().length > 0;

  return (
    <div>
      {/* Discord Settings */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
          </svg>
          Discord Notifications
          <Badge tone={hasDiscord ? 'green' : 'gray'}>{hasDiscord ? 'Connected' : 'Not connected'}</Badge>
        </h3>
        
        {!hasDiscord ? (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ 
              padding: '1rem', 
              background: 'var(--surface-alt)', 
              borderRadius: '12px',
              marginBottom: '1rem'
            }}>
              <p style={{ margin: '0 0 0.75rem', color: 'var(--body-alt)' }}>
                To receive Discord DM notifications, you need to:
              </p>
              <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--body-alt)', lineHeight: 1.8 }}>
                <li>Join the Synthica Discord server</li>
                <li>Enter your Discord username or User ID below</li>
              </ol>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <input
                type="text"
                placeholder="Your Discord username or User ID"
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
                className="form-input"
                style={{ flex: 1 }}
              />
              <Button onClick={handleDiscordSave} disabled={savingDiscord || !discord.trim()}>
                {savingDiscord ? 'Saving...' : 'Save'}
              </Button>
            </div>
            
            <a 
              href={DISCORD_SERVER_LINK} 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
              </svg>
              Join Synthica Discord Server
            </a>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <Badge tone="green">Connected</Badge>
              <span style={{ color: 'var(--body-alt)' }}>
                Receiving DMs as: <strong>{user.discord}</strong>
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Update Discord username or User ID"
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
                className="form-input"
                style={{ flex: 1 }}
              />
              <Button onClick={handleDiscordSave} disabled={savingDiscord}>
                {savingDiscord ? 'Saving...' : 'Update'}
              </Button>
              <Button onClick={handleSendTestDM} disabled={sendingTest} variant="secondary">
                {sendingTest ? 'Sending...' : 'Send Test DM'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Email Notifications */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          Email Notifications
          <Badge tone="blue" style={{ marginLeft: '0.5rem' }}>Enabled by default</Badge>
        </h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {NOTIFICATION_TYPES.map(({ key, label, desc }) => (
            <div key={key} style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '0.75rem',
              background: 'var(--surface-alt)',
              borderRadius: '8px'
            }}>
              <div>
                <div style={{ fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--body-alt)' }}>{desc}</div>
              </div>
              <Toggle 
                checked={emailEnabled[key]} 
                onChange={() => handleToggleEmail(key)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Discord Notifications */}
      {hasDiscord && (
        <Card style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Discord DM Notifications
            <Badge tone="green" style={{ marginLeft: '0.5rem' }}>Connected</Badge>
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {NOTIFICATION_TYPES.map(({ key, label, desc }) => (
              <div key={key} style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                padding: '0.75rem',
                background: 'var(--surface-alt)',
                borderRadius: '8px'
              }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{label}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--body-alt)' }}>{desc}</div>
                </div>
                <Toggle 
                  checked={discordEnabled[key]} 
                  onChange={() => handleToggleDiscord(key)}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Button onClick={handleSavePreferences} disabled={savingPrefs}>
        {savingPrefs ? 'Saving...' : 'Save Preferences'}
      </Button>
    </div>
  );
}

// Wrap with error boundary for production error catching
export default function Notifications() {
  return (
    <ErrorBoundary>
      <NotificationsContent />
    </ErrorBoundary>
  );
}
