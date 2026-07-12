import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Button, Field, Badge } from '../components/ui.jsx';
import { useToast } from '../components/toast.jsx';
import { imageSrc } from '../files.js';
import { safeHref } from '../url.js';
import UploadButton from '../components/UploadButton.jsx';
import Icon from '../components/Icon.jsx';

// Common social platforms for the repeatable "More social links" adder. The
// dedicated fields above cover the researcher essentials (LinkedIn, GitHub, X,
// Scholar, ORCID, Website); this list is for everything else.
const SOCIAL_PLATFORMS = ['Instagram', 'YouTube', 'TikTok', 'ResearchGate', 'Bluesky', 'Mastodon', 'Facebook', 'Discord', 'Substack', 'Personal site'];

// Everyone can edit their own public profile (shown on synthica.org and in-app).
export default function Profile() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  // Guard: RequireAuth gates this route, but never assume user is present.
  const [form, setForm] = useState(() => ({
    name: user?.name || '',
    pronouns: user?.pronouns || '',
    blurb: user?.blurb || '',
    avatarUrl: user?.avatarUrl || '',
    affiliation1: (user?.affiliations?.[0]) || user?.institution || '',
    affiliation2: (user?.affiliations?.[1]) || '',
    contactEmail: user?.contactEmail || '',
    discord: user?.discord || '',
    interests: (user?.interests || []).join(', '),
    researchGroup: user?.researchGroup || '',
    researchGroupUrl: user?.researchGroupUrl || '',
    bio: user?.bio || '',
    linkedinUrl: user?.linkedinUrl || '',
    websiteUrl: user?.websiteUrl || '',
    githubUrl: user?.githubUrl || '',
    twitterUrl: user?.twitterUrl || '',
    scholarUrl: user?.scholarUrl || '',
    orcid: user?.orcid || '',
    dob: user?.dob || '',
    dobPublic: user?.dobPublic === true,
    public: user?.public !== false,
    links: user?.links?.length ? user.links : [{ label: '', url: '' }],
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!user) return <div className="page-loading">Loading…</div>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setLinkField = (i, k, value) => {
    const links = form.links.slice();
    links[i] = { ...links[i], [k]: value };
    setForm({ ...form, links });
  };
  const removeLink = (i) => setForm({ ...form, links: form.links.filter((_, j) => j !== i) });

  const copyProfileLink = async () => {
    const url = `${window.location.origin}/p/${user.slug || user.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Public profile link copied');
    } catch {
      toast.error(url);
    }
  };

  // Light client-side validation: catch the obvious mistakes with a friendly
  // message before the round-trip. The backend still sanitizes on write.
  const validate = () => {
    if (!form.name.trim()) return 'Please enter a display name.';
    if (form.contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail.trim())) {
      return 'That contact email doesn’t look right.';
    }
    if (form.orcid.trim() && !form.orcid.trim().startsWith('http') && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(form.orcid.trim())) {
      return 'ORCID iD should look like 0000-0002-1825-0097.';
    }
    const urlFields = [
      ['LinkedIn', form.linkedinUrl], ['Website', form.websiteUrl], ['GitHub', form.githubUrl],
      ['X / Twitter', form.twitterUrl], ['Google Scholar', form.scholarUrl], ['Research group link', form.researchGroupUrl],
      ...form.links.map((l) => [l.label || 'Social link', l.url]),
    ];
    for (const [label, value] of urlFields) {
      if (value && value.trim() && !safeHref(value)) return `The ${label} link isn’t a valid URL.`;
    }
    return '';
  };

  const save = async (e) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      const { affiliation1, affiliation2, ...rest } = form;
      const affiliations = [affiliation1, affiliation2].map((s) => s.trim()).filter(Boolean);
      const links = form.links.filter((l) => l.url.trim());
      const interests = form.interests.split(',').map((s) => s.trim()).filter(Boolean);
      await api.updateProfile({ ...rest, affiliations, links, interests });
      // Refresh the auth user so the topbar, preview, and other pages reflect
      // the new values immediately (without this, edits looked "lost").
      await refreshUser();
      toast.success('Profile saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // In-app public profile (works on any deployment, no marketing site needed).
  const publicUrl = `/p/${user.slug || user.id}`;
  const roleLine = user.role ? user.role : (user.tags || []).join(', ');
  const previewAffiliations = [form.affiliation1, form.affiliation2].filter(Boolean);

  // Live completeness nudge — encourages filling out the profile that powers
  // the public page, People search, and the mentor directory.
  const checklist = [
    ['Profile picture', !!form.avatarUrl.trim()],
    ['One-line blurb', !!form.blurb.trim()],
    ['Affiliation', !!form.affiliation1.trim()],
    ['Bio', !!form.bio.trim()],
    ['Research interests', !!form.interests.trim()],
    ['A link or social', !!(form.linkedinUrl || form.websiteUrl || form.githubUrl || form.twitterUrl || form.scholarUrl || form.orcid || form.links.some((l) => l.url.trim()))],
  ];
  const completed = checklist.filter(([, done]) => done).length;
  const pct = Math.round((completed / checklist.length) * 100);
  const missing = checklist.filter(([, done]) => !done).map(([label]) => label);

  return (
    <div>
      <div className="card-row" style={{ marginBottom: '1rem', alignItems: 'baseline' }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>My profile</h2>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.88rem' }}>Your public researcher page — it’s what people see on synthica.org and across the dashboard.</p>
        </div>
        <a className="btn btn-ghost btn-sm" href={publicUrl} target="_blank" rel="noreferrer">View public page →</a>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card>
          {error && <div className="login-error">{error}</div>}
          <form onSubmit={save}>
            <div className="field-group-title">Basics</div>
            <Field label="Display name"><input value={form.name} onChange={set('name')} /></Field>
            <div className="row" style={{ gap: '0.6rem' }}>
              <Field label="Pronouns (optional)"><input value={form.pronouns} onChange={set('pronouns')} placeholder="she/her · he/him · they/them" /></Field>
              <Field label="Profile picture">
                <div className="row" style={{ gap: '0.4rem' }}>
                  <input value={form.avatarUrl} onChange={set('avatarUrl')} placeholder="Upload or paste an image URL" />
                  <UploadButton kind="avatar" label="Upload" onUploaded={(r) => setForm((f) => ({ ...f, avatarUrl: r.url }))} />
                </div>
              </Field>
            </div>
            <Field label="One-line blurb (shown everywhere next to your name)">
              <input value={form.blurb} onChange={set('blurb')} maxLength={140} placeholder="e.g. High-schooler studying coral reef genetics" />
            </Field>

            <div className="field-group-title">Affiliations &amp; contact</div>
            <Field label="Affiliation 1 (school, lab, or org)"><input value={form.affiliation1} onChange={set('affiliation1')} placeholder="e.g. Phillips Exeter Academy" /></Field>
            <Field label="Affiliation 2 (optional)"><input value={form.affiliation2} onChange={set('affiliation2')} placeholder="e.g. Synthica Research Group" /></Field>
            <div className="row" style={{ gap: '0.6rem' }}>
              <Field label="Contact email (public)"><input type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="you@example.com" /></Field>
              <Field label="Discord username"><input value={form.discord} onChange={set('discord')} /></Field>
            </div>

            <div className="field-group-title">Research</div>
            <Field label="Research interests (comma-separated)"><input value={form.interests} onChange={set('interests')} placeholder="machine learning, ecology, genomics" /></Field>
            <div className="row" style={{ gap: '0.6rem' }}>
              <Field label="Current research group / lab"><input value={form.researchGroup} onChange={set('researchGroup')} placeholder="e.g. Reef Genomics Group" /></Field>
              <Field label="Research group link (optional)"><input value={form.researchGroupUrl} onChange={set('researchGroupUrl')} placeholder="https://…" /></Field>
            </div>
            <Field label="Bio"><textarea value={form.bio} onChange={set('bio')} placeholder="A few sentences about your research and what you're working on." /></Field>

            <div className="field-group-title">Links &amp; socials</div>
            <div className="row" style={{ gap: '0.6rem' }}>
              <Field label="LinkedIn"><input value={form.linkedinUrl} onChange={set('linkedinUrl')} placeholder="https://linkedin.com/in/…" /></Field>
              <Field label="Website"><input value={form.websiteUrl} onChange={set('websiteUrl')} placeholder="https://…" /></Field>
            </div>
            <div className="row" style={{ gap: '0.6rem' }}>
              <Field label="GitHub"><input value={form.githubUrl} onChange={set('githubUrl')} placeholder="https://github.com/…" /></Field>
              <Field label="X / Twitter"><input value={form.twitterUrl} onChange={set('twitterUrl')} placeholder="https://x.com/…" /></Field>
            </div>
            <div className="row" style={{ gap: '0.6rem' }}>
              <Field label="Google Scholar"><input value={form.scholarUrl} onChange={set('scholarUrl')} placeholder="https://scholar.google.com/…" /></Field>
              <Field label="ORCID iD"><input value={form.orcid} onChange={set('orcid')} placeholder="0000-0002-1825-0097" /></Field>
            </div>

            <div className="field-label">More social links</div>
            <p className="muted" style={{ margin: '0 0 0.5rem' }}>Add any other socials — Instagram, YouTube, ResearchGate, and so on. Pick a platform and paste the link.</p>
            {form.links.map((l, i) => {
              const known = SOCIAL_PLATFORMS.includes(l.label);
              return (
                <div key={i} className="row" style={{ marginBottom: '0.4rem' }}>
                  <select
                    value={known ? l.label : 'Other'}
                    onChange={(e) => setLinkField(i, 'label', e.target.value === 'Other' ? '' : e.target.value)}
                    style={{ maxWidth: 150 }}
                  >
                    {SOCIAL_PLATFORMS.map((s) => <option key={s} value={s}>{s}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                  {!known && (
                    <input placeholder="Label" value={l.label} onChange={(e) => setLinkField(i, 'label', e.target.value)} style={{ maxWidth: 130 }} />
                  )}
                  <input placeholder="https://…" value={l.url} onChange={(e) => setLinkField(i, 'url', e.target.value)} />
                  <button type="button" className="link-remove" aria-label="Remove link" onClick={() => removeLink(i)}>×</button>
                </div>
              );
            })}
            <Button type="button" variant="ghost" className="btn-sm" onClick={() => setForm({ ...form, links: [...form.links, { label: 'Instagram', url: '' }] })}>
              + Add social link
            </Button>

            <div className="field-group-title">Private</div>
            <Field label="Date of birth"><input type="date" value={form.dob} onChange={set('dob')} /></Field>
            <label className="row" style={{ margin: '0.4rem 0' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.dobPublic} onChange={(e) => setForm({ ...form, dobPublic: e.target.checked })} />
              Show my date of birth on my public profile
            </label>
            <p className="muted" style={{ margin: '0 0 0.4rem' }}>Your date of birth is private by default — only you and admins can see it unless you tick the box above.</p>

            <div className="field-group-title">Visibility</div>
            <label className="row" style={{ margin: '0.4rem 0 0.9rem' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />
              Show my profile publicly
            </label>

            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
          </form>
        </Card>

        <div className="stack" style={{ gap: '1rem' }}>
          <Card>
            <div className="card-row" style={{ marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Profile strength</h3>
              <strong style={{ color: pct === 100 ? 'var(--success)' : 'var(--brand-deep)' }}>{pct}%</strong>
            </div>
            <div className="profile-meter"><span style={{ width: `${pct}%` }} /></div>
            {missing.length > 0 ? (
              <p className="muted" style={{ margin: '0.6rem 0 0' }}>Add: {missing.join(' · ')}</p>
            ) : (
              <p className="muted" style={{ margin: '0.6rem 0 0' }}><span className="icon-label"><Icon name="party" size={16} /> Your profile is complete — nice.</span></p>
            )}
          </Card>

          <Card>
          <h3>Preview</h3>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <span className="pfp pfp-lg">
              {form.avatarUrl ? <img src={imageSrc(form.avatarUrl)} alt="" /> : (form.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </span>
            <div>
              <div style={{ fontWeight: 700 }}>{form.name}{form.pronouns && <span className="muted" style={{ fontWeight: 400 }}> · {form.pronouns}</span>}</div>
              <div className="muted">{roleLine}{user.username ? ` · @${user.username}` : ''}</div>
            </div>
          </div>
          {form.blurb && <p style={{ marginTop: '0.5rem', color: 'var(--slate)' }}>{form.blurb}</p>}
          {previewAffiliations.length > 0 && <p className="muted" style={{ marginTop: '0.5rem' }}>{previewAffiliations.join(' · ')}</p>}
          {form.researchGroup && <p className="muted" style={{ marginTop: '0.25rem' }}><span className="icon-label"><Icon name="flask" size={14} /> {form.researchGroup}</span></p>}
          {form.interests.trim() && (
            <div className="row" style={{ marginTop: '0.5rem', gap: '0.3rem' }}>
              {form.interests.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8).map((i) => <Badge key={i} tone="gray">{i}</Badge>)}
            </div>
          )}
          {form.bio && <p style={{ marginTop: '0.5rem' }}>{form.bio}</p>}
          <p style={{ marginTop: '0.75rem' }}>
            <a href={publicUrl} target="_blank" rel="noreferrer">View public profile →</a>{' '}
            {form.public ? <Badge tone="green">public</Badge> : <Badge tone="gray">hidden</Badge>}
          </p>
          <Button type="button" variant="ghost" className="btn-sm" onClick={copyProfileLink}><span className="icon-label"><Icon name="link" size={16} /> Copy profile link</span></Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
