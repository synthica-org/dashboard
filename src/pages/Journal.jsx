import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { safeHref } from '../url.js';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const fmtShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const daysLeft = (iso) => Math.ceil((new Date(iso) - Date.now()) / 86400000);
const authorLine = (a = []) => (a.length > 3 ? `${a.slice(0, 3).join(', ')}, et al.` : a.join(', '));

// Synthica Journal — the public, professional front page. Featured article hero,
// current issue, browse-by-subject, recent + most-read, and a volume index.
export default function Journal() {
  const [d, setD] = useState(null);
  const [comps, setComps] = useState([]);
  useEffect(() => { api.journalOverview().then(setD).catch(() => setD({ })); }, []);
  useEffect(() => { api.journalCompetitions().then(setComps).catch(() => setComps([])); }, []);

  return (
    <div className="jr-page">
      <JournalMast />
      {!d ? <div className="page-loading">Loading…</div> : (
        <main className="jr-body">
          {/* Masthead strapline */}
          <div className="jr-strap">
            <div>
              <h1 className="jr-title">Synthica Journal</h1>
              <p className="jr-sub">Open-access, peer-reviewed research by the next generation of scientists.</p>
            </div>
            <div className="jr-strap-stats">
              <span><b>{d.stats?.papers ?? 0}</b> articles</span>
              <span><b>{d.stats?.volumes ?? 0}</b> volumes</span>
              <span><b>{d.stats?.subjects ?? 0}</b> subjects</span>
            </div>
          </div>

          {d.featured && <FeaturedArticle p={d.featured} />}

          <div className="jr-cols">
            <div className="jr-main-col">
              {d.currentIssue?.length > 0 && (
                <section className="jr-section">
                  <div className="jr-sec-head">
                    <h2>Current issue</h2>
                    {d.latestIssue && <Link to={`/journal/vol/${d.latestIssue.volume}/issue/${d.latestIssue.issue}`} className="jr-more">Volume {d.latestIssue.volume}, Issue {d.latestIssue.issue} →</Link>}
                  </div>
                  <div className="jr-toc">
                    {d.currentIssue.map((p) => <ArticleRow key={p.id} p={p} />)}
                  </div>
                </section>
              )}

              {/* The hero already shows the featured article — don't repeat it here.
                  ("Current issue" keeps it: that's a factual table of contents.) */}
              {(d.recent || []).filter((p) => p.id !== d.featured?.id).length > 0 && (
                <section className="jr-section">
                  <div className="jr-sec-head"><h2>Latest articles</h2><Link to="/archive" className="jr-more">All articles →</Link></div>
                  <div className="jr-toc">
                    {(d.recent || []).filter((p) => p.id !== d.featured?.id).map((p) => <ArticleRow key={p.id} p={p} />)}
                  </div>
                </section>
              )}
            </div>

            <aside className="jr-side-col">
              <CompetitionsCard comps={comps} />

              {(d.subjects || []).length > 0 && (
                <div className="jr-side-card">
                  <h3 className="jr-side-h">Browse by subject</h3>
                  <div className="jr-subjects">
                    {d.subjects.map((s) => (
                      <Link key={s.category} to={`/archive?subject=${encodeURIComponent(s.category)}`} className="jr-subject">
                        <span>{s.category}</span><span className="jr-subject-n">{s.count}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {(d.mostRead || []).length > 0 && (
                <div className="jr-side-card">
                  <h3 className="jr-side-h">Most read</h3>
                  <ol className="jr-mostread">
                    {d.mostRead.map((p) => (
                      <li key={p.id}><Link to={`/article/${p.id}`}>{p.title}</Link><span className="muted"> · {authorLine(p.authors)}</span></li>
                    ))}
                  </ol>
                </div>
              )}

              {(d.volumes || []).length > 0 && (
                <div className="jr-side-card">
                  <h3 className="jr-side-h">All volumes</h3>
                  <div className="jr-vol-list">
                    {d.volumes.map((v) => (
                      <div key={v.volume} className="jr-vol-row">
                        <span className="jr-vol-label">Vol. {v.volume}</span>
                        <span className="jr-vol-issues">
                          {v.issues.map((is) => (
                            <Link key={is.issue} to={`/journal/vol/${v.volume}/issue/${is.issue}`} className="jr-issue-chip">{is.issue}</Link>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>

          <SubmitCTA />
        </main>
      )}
      <JournalFooter />
    </div>
  );
}

// Call-to-action: route members to the dashboard submission pipeline; route
// visitors to sign-up. Submissions flow through review → the Director publishes
// → the paper appears here automatically.
function SubmitCTA() {
  const { user } = useAuth();
  return (
    <section className="jr-cta">
      <div className="jr-cta-body">
        <h2>Publish your research with Synthica</h2>
        <p>Free, open-access, and peer-reviewed by working scientists. Submit from your dashboard — track it through review, and it goes live here the moment it’s accepted.</p>
        <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {user
            ? <Link to="/researcher/journal" className="btn btn-primary">Submit to the Journal →</Link>
            : <Link to="/login" className="btn btn-primary">Join &amp; submit →</Link>}
          <Link to="/preprints" className="btn btn-ghost">Post a preprint</Link>
        </div>
      </div>
    </section>
  );
}

function FeaturedArticle({ p }) {
  return (
    <section className="jr-feature">
      <div className="jr-feature-body">
        <div className="jr-eyebrow">
          <span className="jr-pill-feat"><Icon name="star" size={13} /> Editor’s choice</span>
          <span className="jr-type">{p.articleType}</span>
          {p.openAccess && <span className="jr-oa">Open Access</span>}
        </div>
        <h2 className="jr-feature-title"><Link to={`/article/${p.id}`}>{p.title}</Link></h2>
        <p className="jr-feature-authors">{authorLine(p.authors)}</p>
        {p.abstract && <p className="jr-feature-abstract">{p.abstract}</p>}
        <div className="jr-feature-meta">
          <Link to={`/article/${p.id}`} className="btn btn-primary">Read article</Link>
          <span className="muted">{p.category} · {fmtDate(p.publishedAt)}</span>
        </div>
      </div>
    </section>
  );
}

// Right-rail competitions: the soonest still-open opportunities, read-only.
function CompetitionsCard({ comps }) {
  const open = (comps || [])
    .filter((c) => !c.deadline || daysLeft(c.deadline) >= 0)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 4);
  if (open.length === 0) return null;
  return (
    <div className="jr-side-card jr-comps">
      <h3 className="jr-side-h"><span className="icon-label"><Icon name="trophy" size={15} /> Competitions</span></h3>
      <div className="stack" style={{ gap: '0.7rem' }}>
        {open.map((c) => {
          const href = safeHref(c.url);
          const dl = c.deadline ? daysLeft(c.deadline) : null;
          const Inner = (
            <>
              <div className="jr-comp-title">{c.title}</div>
              <div className="jr-comp-meta">
                {c.prize && <span className="jr-comp-prize"><Icon name="trophy" size={11} /> {c.prize}</span>}
                {c.deadline && <span className={dl <= 7 ? 'badge badge-red' : 'jr-comp-deadline'}>{dl === 0 ? 'closes today' : `${dl}d left`} · {fmtShort(c.deadline)}</span>}
              </div>
            </>
          );
          return href
            ? <a key={c.id} className="jr-comp" href={href} target="_blank" rel="noreferrer">{Inner}</a>
            : <div key={c.id} className="jr-comp">{Inner}</div>;
        })}
      </div>
      <Link to="/competitions" className="jr-more" style={{ display: 'inline-block', marginTop: '0.7rem' }}>All competitions →</Link>
    </div>
  );
}

function ArticleRow({ p }) {
  return (
    <article className="jr-art">
      <div className="jr-art-meta">
        <span className="jr-art-type">{p.articleType}</span>
        {p.openAccess && <span className="jr-oa sm">Open Access</span>}
        <span className="muted">{fmtDate(p.publishedAt)}</span>
      </div>
      <h3 className="jr-art-title"><Link to={`/article/${p.id}`}>{p.title}</Link></h3>
      <p className="jr-art-authors">{authorLine(p.authors)}</p>
      {p.abstract && <p className="jr-art-excerpt">{p.abstract.slice(0, 220)}{p.abstract.length > 220 ? '…' : ''}</p>}
      <div className="jr-art-foot muted">
        {p.category}{p.volume ? ` · Vol. ${p.volume}${p.issue ? `, Issue ${p.issue}` : ''}` : ''}{p.pages ? `, pp. ${p.pages}` : ''}
        {p.accesses > 0 && <> · {p.accesses} views</>}
      </div>
    </article>
  );
}
