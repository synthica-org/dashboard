import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { EXP_ANCHORS, LEAD_ANCHORS, anchorFor } from '../onboardingScales.js';
import Icon from './Icon.jsx';

const FLAG = 'synthica.onboarded.v1';
const INTEREST_OPTIONS = [
  'Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Economics', 'Psychology', 'Humanities',
  'Machine Learning', 'Climate', 'Neuroscience', 'Robotics', 'Genetics', 'Astronomy', 'Public Health', 'Data Science',
];
const SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];

// Inline markers so each step says plainly whether an answer is needed.
const Required = () => <span className="ob-req" title="Required" aria-label="required">*</span>;
const Optional = () => <span className="ob-optional">(optional)</span>;

// Profile setup after sign-up — collects personal info before role selection.
export default function OnboardingWizard() {
  const { user, refreshUser } = useAuth();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const [anim, setAnim] = useState('in');
  const [name, setName] = useState(user?.name || '');
  const [discord, setDiscord] = useState(user?.discord || '');
  const [interests, setInterests] = useState(user?.interests || []);
  const [institution, setInstitution] = useState(user?.institution || '');
  const [gpa, setGpa] = useState(user?.gpa || '');
  const [experienceSummary, setExperienceSummary] = useState(user?.experienceSummary || '');
  const [resumeUrl, setResumeUrl] = useState(user?.resumeUrl || '');
  const [experience, setExperience] = useState(user?.researchExperience ?? 5);
  const [leadership, setLeadership] = useState(user?.leadershipExperience ?? 3);
  const [wantsLead, setWantsLead] = useState(user?.wantsChapterLead ?? false);
  const [pastPapers, setPastPapers] = useState([]);
  const [paper, setPaper] = useState({ title: '', category: SUBJECTS[0], pdfUrl: '', doi: '' });
  const [chapter, setChapter] = useState(null);
  const [busy, setBusy] = useState(false);

  const leadRecommended = Number(experience) >= 8;

  useEffect(() => {
    const staffRole = ['admin', 'director', 'auditor', 'chief', 'senior', 'reviews', 'associate'].includes(user?.role);
    if (user?.kind !== 'researcher' || staffRole) return;
    if (user?.onboarded) return;
    try { if (localStorage.getItem(FLAG)) return; } catch { /* ignore */ }
    api.onboarding().then(setChapter).catch(() => setChapter(null));
    setShow(true);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setName(user.name || '');
    setDiscord(user.discord || '');
    setInterests(user.interests || []);
    setInstitution(user.institution || '');
    setGpa(user.gpa || '');
    setExperienceSummary(user.experienceSummary || '');
    setResumeUrl(user.resumeUrl || '');
    if (user.researchExperience != null) setExperience(user.researchExperience);
    if (user.leadershipExperience != null) setLeadership(user.leadershipExperience);
    setWantsLead(!!user.wantsChapterLead);
  }, [user?.id]);

  if (!show || !user) return null;

  const chapterSteps = chapter?.steps || [];
  const steps = [
    { key: 'welcome' },
    { key: 'name' },
    { key: 'discord' },
    { key: 'institution' },
    { key: 'gpa' },
    { key: 'interests' },
    { key: 'summary' },
    { key: 'experience' },
    { key: 'leadership' },
    { key: 'resume' },
    { key: 'papers' },
    ...chapterSteps.map((s) => ({ key: `chapter:${s.key}`, step: s })),
    { key: 'finish' },
  ];
  const total = steps.length;
  const cur = steps[step];

  // Progress reads as a handful of labeled phases, not 12 anonymous dashes —
  // the perceived cost stays honest ("Profile · Interests · Background").
  const phaseOf = (key) =>
    ['welcome', 'name', 'discord', 'institution', 'gpa'].includes(key) ? 'Profile'
    : ['interests', 'summary'].includes(key) ? 'Interests'
    : key.startsWith('chapter:') ? 'Chapter'
    : 'Background';
  const phases = [...new Set(steps.map((s) => phaseOf(s.key)))];
  const curPhase = phaseOf(cur.key);

  const go = (dir) => {
    setAnim('out');
    setTimeout(() => {
      setStep((s) => Math.min(Math.max(s + dir, 0), total - 1));
      setAnim('in');
    }, 160);
  };

  const toggleInterest = (i) => setInterests((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]));

  const finish = async () => {
    setBusy(true);
    try {
      await api.updateProfile({
        name: name.trim() || user.name,
        discord: discord.trim(),
        interests,
        institution,
        gpa,
        experienceSummary,
        resumeUrl,
        researchExperience: Number(experience),
        leadershipExperience: Number(leadership),
        wantsChapterLead: wantsLead,
        onboarded: true,
      });
      for (const p of pastPapers) await api.addPastPaper(p).catch(() => {});
      if (chapter) await api.onboardingStep('profile', true).catch(() => {});
      await refreshUser?.().catch(() => {});
    } catch { /* ignore */ }
    try { localStorage.setItem(FLAG, '1'); } catch { /* ignore */ }
    setBusy(false);
    setShow(false);
  };

  const markChapter = async (key) => {
    await api.onboardingStep(key, true).catch(() => {});
    go(1);
  };

  return (
    <div className="ob-overlay">
      <div className="ob-card">
        <div className="ob-progress ob-phases" aria-label={`Section ${phases.indexOf(curPhase) + 1} of ${phases.length}: ${curPhase}`}>
          {phases.map((p, i) => {
            const state = i < phases.indexOf(curPhase) ? 'on done' : p === curPhase ? 'on' : '';
            return (
              <span key={p} className={state}>
                <em>{p}</em>
              </span>
            );
          })}
        </div>
        <button type="button" className="ob-skip" onClick={finish}>Skip</button>

        <div className={`ob-step ob-${anim}`}>
          {cur.key === 'welcome' && (
            <>
              <div className="ob-emoji"><Icon name="message" size={40} /></div>
              <h2>Welcome to <span className="yellow-text">Synthica</span>!</h2>
              <p>Let&apos;s set up your profile — then you can pick your role.</p>
              <button type="button" className="btn btn-primary ob-next" onClick={() => go(1)}>Let&apos;s go</button>
            </>
          )}

          {cur.key === 'name' && (
            <>
              <h2>What&apos;s your name? <Required /></h2>
              <p>How you&apos;d like to appear on Synthica.</p>
              <input className="ob-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoFocus />
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'discord' && (
            <>
              <h2>Discord username <Optional /></h2>
              <p>So teammates and auditors can reach you — recommended.</p>
              <input className="ob-input" value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="yourname" autoFocus />
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'interests' && (
            <>
              <h2>What are you into? <Required /></h2>
              <p>Pick a few topics — we&apos;ll personalize your feed.</p>
              <div className="ob-chips">
                {INTEREST_OPTIONS.map((i) => (
                  <button key={i} type="button" className={`ob-chip ${interests.includes(i) ? 'sel' : ''}`} onClick={() => toggleInterest(i)}>{i}</button>
                ))}
              </div>
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" disabled={!interests.length} onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'institution' && (
            <>
              <h2>Where do you study? <Optional /></h2>
              <p>Your school or institution.</p>
              <input className="ob-input" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Lincoln High School" autoFocus />
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'gpa' && (
            <>
              <h2>What&apos;s your GPA? <Optional /></h2>
              <p>Roughly is fine — optional.</p>
              <input className="ob-input" value={gpa} onChange={(e) => setGpa(e.target.value)} placeholder="e.g. 3.8" autoFocus />
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'summary' && (
            <>
              <h2>Your research so far <Optional /></h2>
              <p>Publications, fairs, programs — anything that helps us know you.</p>
              <textarea
                className="ob-input"
                rows={4}
                value={experienceSummary}
                onChange={(e) => setExperienceSummary(e.target.value)}
                placeholder="e.g. ISEF finalist, summer lab internship…"
                maxLength={800}
              />
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'experience' && (
            <>
              <h2>How much research experience do you have? <Required /></h2>
              <p>Rate yourself 0–10.</p>
              <div className="ob-range">
                <input type="range" min="0" max="10" step="1" value={experience} onChange={(e) => setExperience(Number(e.target.value))} autoFocus />
                <div className="ob-range-val">{experience} / 10</div>
              </div>
              <div className="ob-anchor">{anchorFor(EXP_ANCHORS, experience)}</div>
              {leadRecommended && (
                <p className="ob-rec"><span className="icon-label"><Icon name="star" size={16} /> Strong experience — Lead Researcher may be a great fit.</span></p>
              )}
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'leadership' && (
            <>
              <h2>Interested in leading a chapter? <Optional /></h2>
              <p>Chapter leads run a local Synthica group where they live.</p>
              <div className="ob-actions" style={{ justifyContent: 'center', marginBottom: '1rem' }}>
                <button type="button" className={`btn ${wantsLead ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setWantsLead(true)}>Yes</button>
                <button type="button" className={`btn ${!wantsLead ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setWantsLead(false)}>Not now</button>
              </div>
              <p style={{ marginBottom: '0.3rem' }}>Leadership experience (0–10)</p>
              <div className="ob-range">
                <input type="range" min="0" max="10" step="1" value={leadership} onChange={(e) => setLeadership(Number(e.target.value))} />
                <div className="ob-range-val">{leadership} / 10</div>
              </div>
              <div className="ob-anchor">{anchorFor(LEAD_ANCHORS, leadership)}</div>
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'resume' && (
            <>
              <h2>Resume / CV link <Optional /></h2>
              <p>Google Drive, LinkedIn, or any public link.</p>
              <input className="ob-input" value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} placeholder="https://drive.google.com/…" autoFocus />
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.key === 'papers' && (
            <>
              <h2>Published anything already? <Optional /></h2>
              <p>Add past papers now or skip — you can add more later.</p>
              {pastPapers.length > 0 && (
                <div className="ob-paper-list">
                  {pastPapers.map((p, i) => (
                    <div key={i} className="ob-paper-row">
                      <span>{p.title} <span className="muted">· {p.category}</span></span>
                      <button type="button" className="link-btn" onClick={() => setPastPapers((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              <input className="ob-input" value={paper.title} onChange={(e) => setPaper({ ...paper, title: e.target.value })} placeholder="Paper title" style={{ marginBottom: '0.5rem' }} />
              <div className="row" style={{ gap: '0.4rem', marginBottom: '0.5rem' }}>
                <select value={paper.category} onChange={(e) => setPaper({ ...paper, category: e.target.value })} style={{ width: 'auto' }}>
                  {SUBJECTS.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input value={paper.doi} onChange={(e) => setPaper({ ...paper, doi: e.target.value })} placeholder="DOI (optional)" style={{ flex: 1 }} />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!paper.title.trim()}
                onClick={() => { setPastPapers((xs) => [...xs, paper]); setPaper({ title: '', category: SUBJECTS[0], pdfUrl: '', doi: '' }); }}
              >+ Add paper</button>
              <div className="ob-actions" style={{ marginTop: '0.6rem' }}>
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => go(1)}>Continue</button>
              </div>
            </>
          )}

          {cur.step && (
            <>
              <div className="ob-emoji"><Icon name="check-square" size={40} /></div>
              <h2>{cur.step.label}</h2>
              <p>Tick this off once you&apos;ve done it.</p>
              <div className="ob-actions">
                <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>Back</button>
                <button type="button" className="btn btn-ghost" onClick={() => go(1)}>Later</button>
                <button type="button" className="btn btn-primary" onClick={() => markChapter(cur.step.key)}><span className="icon-label"><Icon name="check" size={14} /> Done</span></button>
              </div>
            </>
          )}

          {cur.key === 'finish' && (
            <>
              <div className="ob-emoji"><Icon name="party" size={40} /></div>
              <h2>Profile saved!</h2>
              <p>Next up: choose how you want to participate at Synthica.</p>
              <button type="button" className="btn btn-primary ob-next" disabled={busy} onClick={finish}>{busy ? 'Saving…' : 'Continue to roles'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
