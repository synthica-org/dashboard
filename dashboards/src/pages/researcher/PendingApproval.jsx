import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth, firstNameOf } from '../../auth.jsx';
import Icon from '../../components/Icon.jsx';
import { EXP_ANCHORS, LEAD_ANCHORS, anchorFor } from '../../onboardingScales.js';

const INTERESTS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Economics', 'Psychology', 'Humanities', 'Machine Learning', 'Neuroscience'];
const SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

// Holding screen for a newly-registered researcher until a Moderator assigns
// their role (ROLE_WORKFLOWS §3.1). First visit: a short intake form. After
// submitting: a clear status view (the form stays reachable behind "Edit
// details"). If a Moderator declines, a rejected view lets them revise and
// resubmit instead of hitting a dead end.
export default function PendingApproval() {
  const { user, logout, refreshUser } = useAuth();
  // Saving the intake sets researchExperience — use that as "submitted".
  const submitted = user?.researchExperience != null;
  const [editing, setEditing] = useState(!submitted);
  const [checked, setChecked] = useState('');

  // Poll for approval so the member drops straight into the app once a role is set.
  useEffect(() => {
    const tick = () => refreshUser();
    const id = setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); window.removeEventListener('focus', tick); };
  }, [refreshUser]);

  const checkNow = async () => {
    await refreshUser();
    setChecked(`Still under review — last checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  };

  // The Moderator declined this sign-up: say so, and give a way forward.
  if (user?.onboardingRejected && !editing) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ maxWidth: 480 }}>
          <span className="guide-ico guide-ico-lg" aria-hidden="true" style={{ marginBottom: '0.5rem' }}><Icon name="inbox" size={22} /></span>
          <h1 style={{ marginBottom: '0.25rem' }}>Your application wasn't approved</h1>
          <p className="sub">
            Thanks for your interest in Synthica. Our Moderators couldn't approve your membership this time.
            You can strengthen your profile below and ask us to take another look, or reach out on Discord or
            email if you think this was a mistake.
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: '0.6rem' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>Revise &amp; resubmit</button>
            <button className="btn btn-ghost btn-sm" onClick={checkNow}>Check again</button>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <button className="link-btn" onClick={logout}>Sign out</button>
          </div>
          {checked && <p className="muted" style={{ marginTop: '0.6rem' }}>{checked.replace('Still under review — last checked', 'No change yet — checked')}</p>}
        </div>
      </div>
    );
  }

  // Status view — what they see on every sign-in after submitting the intake.
  if (submitted && !editing) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ maxWidth: 480 }}>
          <span className="guide-ico guide-ico-lg" aria-hidden="true" style={{ marginBottom: '0.5rem' }}><Icon name="clock" size={22} /></span>
          <h1 style={{ marginBottom: '0.25rem' }}>Application under review</h1>
          <p className="sub">
            Thanks, {firstNameOf(user?.name)} — a Moderator is reviewing your profile and assigning your
            starting role (usually Associate Researcher). You'll get access automatically the moment it's done.
          </p>

          <div className="info-block" style={{ textAlign: 'left', marginBottom: '1rem' }}>
            <strong style={{ display: 'block', marginBottom: '0.45rem' }}>What happens next</strong>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem', fontSize: '0.85rem' }}>
              <li className="icon-label"><Icon name="check-circle" size={14} /> You created your account and submitted your profile.</li>
              <li className="icon-label"><Icon name="clock" size={14} /> A Moderator reviews it and assigns your starting role.</li>
              <li className="icon-label"><Icon name="rocket" size={14} /> You're dropped into your dashboard — no need to refresh.</li>
            </ul>
          </div>

          <div className="row" style={{ justifyContent: 'center', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <span className="badge badge-blue">Research {user.researchExperience}/10</span>
            <span className="badge badge-blue">Leadership {user.leadershipExperience ?? '—'}/10</span>
            {user.wantsChapterLead && <span className="badge badge-gold">Chapter lead candidate</span>}
            <span className={`badge ${user.resumeUrl ? 'badge-green' : 'badge-gray'}`}>{user.resumeUrl ? <><Icon name="check" size={11} /> Résumé added</> : 'No résumé yet'}</span>
          </div>

          {!user.resumeUrl && (
            <p className="muted" style={{ marginBottom: '1rem' }}>Tip: adding a résumé helps the Moderator place you faster.</p>
          )}
          <p className="muted" style={{ marginBottom: '0.8rem', fontSize: '0.8rem' }}>This page checks for a decision on its own every few seconds.</p>
          {checked && <p className="muted" style={{ marginBottom: '0.8rem' }}>{checked}</p>}

          <div className="row" style={{ justifyContent: 'center', gap: '0.6rem' }}>
            <button className="btn btn-primary btn-sm" onClick={checkNow}>Check status now</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit details</button>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <button className="link-btn" onClick={logout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <IntakeForm
      user={user}
      refreshUser={refreshUser}
      logout={logout}
      rejected={!!user?.onboardingRejected}
      onDone={() => setEditing(false)}
    />
  );
}

// The intake form, shown once (and again behind "Edit details" / "Revise").
function IntakeForm({ user, refreshUser, logout, onDone, rejected }) {
  const [f, setF] = useState({
    resumeUrl: user?.resumeUrl || '',
    institution: user?.institution || '',
    gpa: user?.gpa || '',
    interests: user?.interests || [],
    experienceSummary: user?.experienceSummary || '',
    researchExperience: user?.researchExperience ?? 5,
    leadershipExperience: user?.leadershipExperience ?? 3,
    wantsChapterLead: user?.wantsChapterLead ?? false,
    priorLead: user?.priorLead ?? false,
    legacyProject: user?.legacyProject || { title: '', category: SUBJECTS[0], description: '' },
  });
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (i) => set({ interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i] });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.updateProfile({
        resumeUrl: f.resumeUrl, institution: f.institution, gpa: f.gpa, interests: f.interests,
        experienceSummary: f.experienceSummary,
        researchExperience: Number(f.researchExperience), leadershipExperience: Number(f.leadershipExperience),
        wantsChapterLead: f.wantsChapterLead,
        priorLead: f.priorLead,
        legacyProject: f.priorLead && f.legacyProject.title.trim() ? f.legacyProject : null,
      });
      // A previously-rejected member is asking for another review: re-queue them.
      if (rejected) await api.resubmitOnboarding().catch(() => {});
      await refreshUser();
      onDone();
    } catch (err) {
      setError(err?.message || 'Could not save — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 520, textAlign: 'left' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>
          {rejected ? 'Update your profile' : `One last step, ${firstNameOf(user?.name)}`}
        </h1>
        <p className="sub">
          {rejected
            ? 'Strengthen your profile and resubmit — a Moderator will take another look.'
            : 'Tell us a little about yourself so our Moderators can assign you the right starting role.'}
        </p>
        {error && <div className="login-error">{error}</div>}

        <label className="label-up">Resume / CV link <span className="muted">(recommended)</span></label>
        <input value={f.resumeUrl} onChange={(e) => set({ resumeUrl: e.target.value })} placeholder="https://drive.google.com/…" style={{ marginBottom: '0.7rem' }} />

        <div className="grid grid-2" style={{ marginBottom: '0.7rem' }}>
          <div>
            <label className="label-up">School / institution</label>
            <input value={f.institution} onChange={(e) => set({ institution: e.target.value })} placeholder="Lincoln High School" />
          </div>
          <div>
            <label className="label-up">GPA <span className="muted">(optional)</span></label>
            <input value={f.gpa} onChange={(e) => set({ gpa: e.target.value })} placeholder="3.8" />
          </div>
        </div>

        <label className="label-up">Your research so far <span className="muted">(publications, fairs, programs…)</span></label>
        <textarea
          value={f.experienceSummary}
          onChange={(e) => set({ experienceSummary: e.target.value })}
          rows={3}
          maxLength={800}
          placeholder="e.g. Published a preprint on coral genetics, ISEF finalist 2025, summer lab internship at UCSD…"
          style={{ marginBottom: '0.7rem' }}
        />

        <label className="label-up">Research experience</label>
        <div className="ob-range" style={{ margin: '0.2rem 0 0' }}>
          <input type="range" min="0" max="10" step="1" value={f.researchExperience} onChange={(e) => set({ researchExperience: Number(e.target.value) })} />
          <div className="ob-range-val">{f.researchExperience} / 10</div>
        </div>
        <div className="ob-anchor" style={{ margin: '0.15rem 0 0.7rem' }}>{anchorFor(EXP_ANCHORS, f.researchExperience)}</div>

        <label className="label-up">Want to lead a local chapter?</label>
        <div className="row" style={{ gap: '0.4rem', margin: '0.25rem 0 0.7rem' }}>
          <button type="button" className={`btn btn-sm ${f.wantsChapterLead ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ wantsChapterLead: true })}>Yes</button>
          <button type="button" className={`btn btn-sm ${!f.wantsChapterLead ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ wantsChapterLead: false })}>Not now</button>
        </div>

        <label className="label-up">Leadership experience</label>
        <div className="ob-range" style={{ margin: '0.2rem 0 0' }}>
          <input type="range" min="0" max="10" step="1" value={f.leadershipExperience} onChange={(e) => set({ leadershipExperience: Number(e.target.value) })} />
          <div className="ob-range-val">{f.leadershipExperience} / 10</div>
        </div>
        <div className="ob-anchor" style={{ margin: '0.15rem 0 0.7rem' }}>{anchorFor(LEAD_ANCHORS, f.leadershipExperience)}</div>

        <label className="label-up">Were you a Lead Researcher in our old system?</label>
        <div className="row" style={{ gap: '0.4rem', margin: '0.25rem 0 0.7rem' }}>
          <button type="button" className={`btn btn-sm ${f.priorLead ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ priorLead: true })}>Yes, I led a project</button>
          <button type="button" className={`btn btn-sm ${!f.priorLead ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ priorLead: false })}>No</button>
        </div>
        {f.priorLead && (
          <div className="info-block" style={{ marginBottom: '0.7rem' }}>
            <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.8rem' }}>
              Tell us about it — if a Moderator confirms you as a Lead, your project is restored automatically and you can re-invite your team.
            </p>
            <input value={f.legacyProject.title} onChange={(e) => set({ legacyProject: { ...f.legacyProject, title: e.target.value } })} placeholder="Project title" style={{ marginBottom: '0.5rem' }} />
            <div className="row" style={{ gap: '0.4rem', marginBottom: '0.5rem' }}>
              <select value={f.legacyProject.category} onChange={(e) => set({ legacyProject: { ...f.legacyProject, category: e.target.value } })} style={{ width: 'auto' }}>
                {SUBJECTS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <textarea value={f.legacyProject.description} onChange={(e) => set({ legacyProject: { ...f.legacyProject, description: e.target.value } })} rows={2} placeholder="One or two sentences about the project" />
          </div>
        )}

        <label className="label-up">Interests</label>
        <div className="row" style={{ gap: '0.35rem', margin: '0.3rem 0 1rem', flexWrap: 'wrap' }}>
          {INTERESTS.map((i) => (
            <button key={i} type="button" className={`badge ${f.interests.includes(i) ? 'badge-blue' : 'badge-gray'}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => toggle(i)}>{i}</button>
          ))}
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Submitting…' : rejected ? 'Resubmit for review' : 'Submit for review'}</button>
          <button className="link-btn" onClick={logout}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
