import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { safeHref } from '../url.js';
import Icon from '../components/Icon.jsx';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const daysLeft = (iso) => Math.ceil((new Date(iso) - Date.now()) / 86400000);

function DeadlinePill({ deadline }) {
  if (!deadline) return null;
  const dl = daysLeft(deadline);
  if (dl < 0) return <span className="jr-comp-deadline">closed · {fmtDay(deadline)}</span>;
  return <span className={`jr-comp-deadline${dl <= 7 ? ' urgent' : ''}`}>{dl === 0 ? 'closes today' : `${dl} days left`} · {fmtDay(deadline)}</span>;
}

// Public competitions board — visible without login; deeper actions (applying,
// tracking, posting) live in the dashboard.
export default function CompetitionsPublic() {
  const { user } = useAuth();
  const [comps, setComps] = useState(null);
  useEffect(() => { api.journalCompetitions().then(setComps).catch(() => setComps([])); }, []);

  const open = (comps || []).filter((c) => !c.deadline || daysLeft(c.deadline) >= 0)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const featured = open[0] || null;
  const rest = (comps || []).filter((c) => c.id !== featured?.id);

  return (
    <div className="jr-page">
      <JournalMast />
      <main className="jr-body">
        <div className="jr-strap">
          <div>
            <h1 className="jr-title">Competitions</h1>
            <p className="jr-sub">Research competitions and opportunities for student scientists — curated by Synthica.</p>
          </div>
        </div>

        {!comps ? <div className="page-loading">Loading…</div> : comps.length === 0 ? (
          <p className="muted">No competitions posted right now — check back soon.</p>
        ) : (
          <>
            {featured && (
              <section className="jr-feature">
                <div className="jr-feature-body">
                  <div className="jr-eyebrow"><span className="jr-pill-feat"><Icon name="trophy" size={13} /> Closing soonest</span>{featured.category && <span className="jr-type">{featured.category}</span>}</div>
                  <h2 className="jr-feature-title">{featured.title}</h2>
                  {featured.description && <p className="jr-feature-abstract">{featured.description}</p>}
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {featured.prize && <span className="jr-comp-prize" style={{ color: '#6ee7b7' }}><Icon name="trophy" size={12} /> {featured.prize}</span>}
                    <DeadlinePill deadline={featured.deadline} />
                  </div>
                  {safeHref(featured.url) && <a className="btn btn-primary" href={safeHref(featured.url)} target="_blank" rel="noreferrer">Learn more →</a>}
                </div>
              </section>
            )}

            <div className="jr-cols">
              <div className="jr-main-col">
                <div className="grid grid-2">
                  {rest.map((c) => {
                    const href = safeHref(c.url);
                    return (
                      <div key={c.id} className="jr-side-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div className="jr-comp-meta">
                          {c.category && <span className="jr-art-type">{c.category}</span>}
                          <DeadlinePill deadline={c.deadline} />
                        </div>
                        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{c.title}</h3>
                        {c.description && <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>{c.description}</p>}
                        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto' }}>
                          {c.prize && <span className="jr-comp-prize"><Icon name="trophy" size={11} /> {c.prize}</span>}
                          {href && <a className="btn btn-ghost btn-sm" href={href} target="_blank" rel="noreferrer">Learn more →</a>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="jr-side-col">
                <div className="jr-side-card jr-comps">
                  <h3 className="jr-side-h">Get involved</h3>
                  <p className="muted" style={{ fontSize: '0.86rem', marginTop: 0 }}>
                    Sign in to track deadlines, form teams, and get matched to competitions in your field — all from your dashboard.
                  </p>
                  {user
                    ? <Link to="/researcher/competitions" className="btn btn-primary btn-sm">Open in dashboard →</Link>
                    : <Link to="/login" className="btn btn-primary btn-sm">Sign in to apply →</Link>}
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
      <JournalFooter />
    </div>
  );
}
