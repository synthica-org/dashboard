import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Badge, Pfp } from '../components/ui.jsx';
import { imageSrc } from '../files.js';
import { safeHref } from '../url.js';
import { useReloadOnFocus } from '../useReload.js';
import Icon, { BrandMark } from '../components/Icon.jsx';

// Researcher tags → human labels for the role badges on the public profile.
const TAG_LABEL = {
  associate_researcher: 'Associate Researcher',
  lead_researcher: 'Lead Researcher',
  independent_researcher: 'Independent Researcher',
  chapter_leader: 'Chapter Leader',
  expertise_mentor: 'Expertise Mentor',
};

// Public member profile — works without login, resolves by id or slug.
export default function PublicProfile() {
  const { key } = useParams();
  const { user } = useAuth();
  const [p, setP] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    setMissing(false);
    api.profile(key).then(setP).catch(() => setMissing(true));
  }, [key]);
  useEffect(() => { setP(null); load(); }, [load]);
  useReloadOnFocus(load);

  if (missing) {
    return (
      <div className="pv-wrap">
        <Link to="/" className="topbar-brand"><BrandMark size={22} />Synthica</Link>
        <div className="pv-card pv-center">
          <h1 className="pv-title">Profile not found</h1>
          <p className="pv-sub">This member may have set their profile to private.</p>
          <Link className="btn btn-primary" to="/archive" style={{ marginTop: '1rem' }}>Browse the archive</Link>
        </div>
      </div>
    );
  }
  if (!p) return <div className="page-loading">Loading…</div>;

  return (
    <div className="archive-page">
      <nav className="archive-topnav">
        <Link to="/" className="topbar-brand"><BrandMark size={22} />Synthica</Link>
        <span className="row" style={{ gap: '0.8rem' }}>
          {user && user.id !== p.id && <Link className="btn btn-primary btn-sm" to={`/researcher/messages/${p.id}`}><span className="icon-label"><Icon name="message" size={16} /> Message</span></Link>}
          <Link className="btn btn-ghost btn-sm" to="/archive">Archive</Link>
          {user ? <Link className="btn btn-ghost btn-sm" to="/">My dashboard</Link> : <Link className="btn btn-ghost btn-sm" to="/login">Sign in</Link>}
        </span>
      </nav>

      <main className="archive-body">
        <Card>
          <div className="row" style={{ gap: '1rem', alignItems: 'center' }}>
            <Pfp name={p.name} url={imageSrc(p.avatarUrl)} size="lg" />
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>
                {p.name}{p.pronouns && <span className="muted" style={{ fontSize: '0.9rem', fontWeight: 400 }}> · {p.pronouns}</span>}
              </h1>
              <div className="muted">{p.role}{p.username ? ` · @${p.username}` : ''}</div>
              {(p.affiliations || []).length > 0 && <div className="muted">{p.affiliations.join(' · ')}</div>}
              {p.blurb && <p style={{ margin: '0.35rem 0 0', color: 'var(--slate)' }}>{p.blurb}</p>}
              {(p.tags || []).length > 0 && (
                <div className="row" style={{ marginTop: '0.45rem', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {p.tags.map((t) => <Badge key={t} tone="blue">{TAG_LABEL[t] || t}</Badge>)}
                </div>
              )}
            </div>
          </div>

          {(p.researchGroup || p.dob || p.contactEmail) && (
            <div className="stack" style={{ marginTop: '0.7rem', gap: '0.2rem' }}>
              {p.researchGroup && (
                <div className="muted"><span className="icon-label"><Icon name="flask" size={14} /> {safeHref(p.researchGroupUrl) ? <a href={safeHref(p.researchGroupUrl)} target="_blank" rel="noreferrer">{p.researchGroup}</a> : p.researchGroup}</span></div>
              )}
              {p.contactEmail && <div className="muted"><span className="icon-label"><Icon name="mail" size={14} /> <a href={`mailto:${p.contactEmail}`}>{p.contactEmail}</a></span></div>}
              {p.dob && <div className="muted"><span className="icon-label"><Icon name="cake" size={14} /> {p.dob}</span></div>}
            </div>
          )}

          {(p.interests || []).length > 0 && (
            <div className="row" style={{ marginTop: '0.7rem', gap: '0.3rem' }}>
              {p.interests.map((i) => <Badge key={i} tone="gray">{i}</Badge>)}
            </div>
          )}

          <SocialLinks p={p} />

          {(p.badges || []).length > 0 && (
            <div className="row" style={{ marginTop: '0.7rem', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {p.reputation > 0 && <Badge tone="gold"><span className="icon-label"><Icon name="star" size={12} /> {p.reputation} rep</span></Badge>}
              {p.badges.map((b) => <Badge key={b.id} tone="blue" title={b.label}><Icon name={b.icon} size={12} /> {b.label}</Badge>)}
            </div>
          )}
        </Card>

        {p.bio && (
          <Card>
            <h2 className="pp-label">About</h2>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.bio}</p>
          </Card>
        )}

        {(p.groups || []).length > 0 && (
          <Card>
            <h2 className="pp-label">Research groups</h2>
            <div className="row" style={{ gap: '0.4rem' }}>
              {p.groups.map((g) => <Badge key={g.id} tone="blue">{g.name}</Badge>)}
            </div>
          </Card>
        )}

        {(p.currentProjects || []).length > 0 && (
          <Card>
            <h2 className="pp-label">Current projects</h2>
            <div className="stack">
              {p.currentProjects.map((pr) => (
                <div key={pr.id} className="muted">
                  {pr.title} <Badge tone="gray">{pr.category}</Badge>
                  {pr.role && <> <Badge tone="blue">{pr.role}</Badge></>}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <h2 className="pp-label">Published research <Badge tone="gray">{(p.publications || []).length}</Badge></h2>
          {(p.publications || []).length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No published research yet.</p>
          ) : (
            <div>
              {p.publications.map((pub) => (
                <div key={pub.doi} className="pp-pub">
                  {pub.pdfUrl ? <a href={pub.pdfUrl} target="_blank" rel="noreferrer"><strong>{pub.title}</strong></a> : <strong>{pub.title}</strong>}
                  {pub.verified === false && <> <Badge tone="gold">awaiting verification</Badge></>}
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {pub.articleType || 'Article'} · {pub.category} · {pub.publishedAt} · {pub.doi}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

// A compact row of social / research links. ORCID accepts a bare iD or a URL.
// Every href is run through safeHref so a legacy javascript: value can't fire.
function SocialLinks({ p }) {
  const orcidHref = p.orcid ? (p.orcid.startsWith('http') ? p.orcid : `https://orcid.org/${p.orcid}`) : '';
  const items = [
    ['LinkedIn', p.linkedinUrl],
    ['Website', p.websiteUrl],
    ['GitHub', p.githubUrl],
    ['X', p.twitterUrl],
    ['Google Scholar', p.scholarUrl],
    ['ORCID', orcidHref],
    ...(p.links || []).map((l) => [l.label, l.url]),
  ].map(([label, url]) => [label, safeHref(url)]).filter(([, url]) => url);
  if (!items.length) return null;
  return (
    <div className="row" style={{ marginTop: '0.6rem', gap: '0.75rem' }}>
      {items.map(([label, url]) => (
        <a key={label + url} href={url} target="_blank" rel="noreferrer">{label}</a>
      ))}
    </div>
  );
}
