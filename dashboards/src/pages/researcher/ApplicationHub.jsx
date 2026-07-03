import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Card, Badge, Button, Field, EmptyState } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../components/toast.jsx';

// Role-specific application forms. `key` is the question label stored in answers.
// Associate Researcher is intentionally absent — it's granted on onboarding
// approval, never applied for (ROLE_WORKFLOWS §3.2 / §4).
const COMMON = [
  { key: 'Full Name', type: 'text', required: true },
  { key: 'Discord Display Name', type: 'text', required: true },
  { key: 'Email', type: 'email', required: true },
  { key: 'Date of Birth', type: 'date' },
  { key: 'Location (City, State, Country)', type: 'text' },
  { key: 'Current Grade Level (e.g. HS10, U3, Graduate, PhD)', type: 'text' },
  { key: 'Current School', type: 'text' },
  { key: 'Commitment Hours per Week (e.g. 40 hours)', type: 'text' },
  { key: 'Background in Research', type: 'textarea' },
];

const FORMS = {
  'Lead Researcher': [
    ...COMMON,
    { key: 'Current GPA', type: 'text' },
    { key: 'Intended Research Topic (cannot be N/A)', type: 'text', required: true },
    { key: 'How do you plan to conduct your research topic? (150 words max)', type: 'textarea', required: true },
    { key: 'Why should we make you a lead researcher? (150 words max)', type: 'textarea', required: true },
  ],
  'Independent Researcher': [
    ...COMMON,
    { key: 'What do you want to research independently?', type: 'textarea', required: true },
    { key: 'Intended methodology / approach', type: 'textarea' },
  ],
  'Chapter Leader': [
    ...COMMON,
    { key: 'Where would you run your chapter? (school, city, region)', type: 'text', required: true },
    { key: 'Why do you want to lead a chapter? (150 words max)', type: 'textarea', required: true },
  ],
};

const ROLES = Object.keys(FORMS);

// One-line pitch shown above each role's form.
const ROLE_BLURB = {
  'Lead Researcher': 'Run your own project and recruit a team. We review your research background and plan.',
  'Independent Researcher': 'Pursue a solo, self-directed project. A Moderator reviews your research intent before you begin.',
  'Chapter Leader': 'Start and lead a local Synthica chapter. We review your leadership intent and location.',
};

const TAG_FOR_ROLE = {
  'Lead Researcher': 'lead_researcher',
  'Independent Researcher': 'independent_researcher',
  'Chapter Leader': 'chapter_leader',
};

const STATUS_TONE = { pending: 'gray', approved: 'green', rejected: 'red' };
const STATUS_LABEL = { pending: 'Under review', approved: 'Approved', rejected: 'Not approved' };

export default function ApplicationHub() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  // Deep links (e.g. /researcher/apply?role=Chapter%20Leader) preselect the role.
  const initialRole = ROLES.includes(params.get('role')) ? params.get('role') : 'Lead Researcher';
  const [role, setRole] = useState(initialRole);
  const [answers, setAnswers] = useState({});
  const [apps, setApps] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.myApplications().then(setApps).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Prefill what we already know about the member when the role changes, so they
  // don't retype their name/school/background for every application.
  useEffect(() => {
    setAnswers((a) => ({
      'Full Name': user.name || '',
      'Discord Display Name': user.discord || '',
      Email: user.email || '',
      'Current School': user.institution || '',
      'Current GPA': user.gpa || '',
      'Background in Research': user.experienceSummary || '',
      ...a,
    }));
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = FORMS[role];
  const set = (k) => (e) => setAnswers({ ...answers, [k]: e.target.value });

  const alreadyHasRole = (user?.tags || []).includes(TAG_FOR_ROLE[role]);
  const pendingForRole = apps.some((a) => a.role === role && a.status === 'pending');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Send the first required essay as the headline `message` (what the
      // Moderator queue previews); the full set of answers rides along too.
      const message = answers[fields.find((f) => f.type === 'textarea' && f.required)?.key] || '';
      await api.apply({ role, answers, message });
      setAnswers({});
      toast.success('Application submitted — a Moderator will review it.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const roleApps = apps.filter((a) => a.role);

  return (
    <div>
      <h1 className="page-title">Apply for a role</h1>
      <p className="page-sub">
        Explore advanced roles and apply. A Moderator reviews each application — once approved, your role
        and workspace unlock automatically. (Associate Researcher is already granted to every member.)
      </p>
      {error && <div className="login-error">{error}</div>}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card>
          <h3>Submit an application</h3>
          <Field label="Which role?">
            <select value={role} onChange={(e) => { setRole(e.target.value); setParams({ role: e.target.value }, { replace: true }); }}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>{ROLE_BLURB[role]}</p>

          {alreadyHasRole ? (
            <div className="info-block icon-label"><Icon name="check-circle" size={14} /> <span>You already hold the <strong>{role}</strong> role.</span></div>
          ) : pendingForRole ? (
            <div className="info-block icon-label"><Icon name="clock" size={14} /> <span>Your {role} application is under review — we'll notify you when there's a decision.</span></div>
          ) : (
            <form onSubmit={submit}>
              {fields.map((f) => (
                <Field key={f.key} label={`${f.key}${f.required ? ' *' : ''}`}>
                  {f.type === 'textarea' ? (
                    <textarea value={answers[f.key] || ''} onChange={set(f.key)} required={f.required} />
                  ) : (
                    <input type={f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text'} value={answers[f.key] || ''} onChange={set(f.key)} required={f.required} />
                  )}
                </Field>
              ))}
              <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</Button>
            </form>
          )}
        </Card>

        <Card>
          <h3>My applications</h3>
          {roleApps.length === 0 ? (
            <EmptyState>No role applications yet. Pick a role on the left to get started.</EmptyState>
          ) : (
            <div className="stack">
              {roleApps.map((a) => (
                <div key={a.id} className="info-block">
                  <div className="card-row">
                    <strong>{a.role}</strong>
                    <Badge tone={STATUS_TONE[a.status] || 'gray'}>{STATUS_LABEL[a.status] || a.status}</Badge>
                  </div>
                  {a.status === 'rejected' && (
                    <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.8rem' }}>
                      You can refine your answers and submit a new application above.
                    </p>
                  )}
                  {a.answers && (
                    <details style={{ marginTop: '0.4rem' }}>
                      <summary className="muted" style={{ cursor: 'pointer' }}>View your answers</summary>
                      <div className="stack" style={{ marginTop: '0.3rem' }}>
                        {Object.entries(a.answers).map(([k, v]) => v && (
                          <div key={k} className="muted" style={{ fontSize: '0.8rem' }}><strong>{k}:</strong> {v}</div>
                        ))}
                      </div>
                    </details>
                  )}
                  <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.75rem' }}>Submitted {new Date(a.at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
