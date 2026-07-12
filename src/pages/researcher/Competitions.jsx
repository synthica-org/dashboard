import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, Badge, EmptyState } from '../../components/ui.jsx';
import { safeHref } from '../../url.js';
import Icon from '../../components/Icon.jsx';

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const daysLeft = (iso) => Math.ceil((new Date(iso) - Date.now()) / 86400000);

// Deadline pill with urgency colouring: closing soon → gold, closed → gray.
function DeadlineBadge({ deadline }) {
  if (!deadline) return null;
  const dl = daysLeft(deadline);
  if (dl < 0) return <Badge tone="gray">closed · {fmtDay(deadline)}</Badge>;
  const tone = dl <= 7 ? 'red' : dl <= 21 ? 'gold' : 'blue';
  return <Badge tone={tone}>{dl === 0 ? 'closes today' : `${dl} day${dl === 1 ? '' : 's'} left`} · {fmtDay(deadline)}</Badge>;
}

// Competitions board — opportunities posted by staff. Read-only for members.
// The most time-sensitive open competition is spotlighted as a hero.
export default function Competitions({ embedded }) {
  const [comps, setComps] = useState(null);
  useEffect(() => { api.competitions().then(setComps).catch(() => setComps([])); }, []);
  if (!comps) return <div className="page-loading">Loading…</div>;

  // Spotlight the soonest still-open competition (listCompetitions sorts soonest first).
  const open = comps.filter((c) => !c.deadline || daysLeft(c.deadline) >= 0);
  const featured = open[0] || null;
  const rest = comps.filter((c) => c.id !== featured?.id);

  return (
    <div>
      {!embedded && <h1 className="page-title">Competitions</h1>}
      {!embedded && <p className="page-sub">Research competitions and opportunities worth your time.</p>}
      {comps.length === 0 ? (
        <EmptyState>No competitions posted right now — check back soon.</EmptyState>
      ) : (
        <>
          {featured && <FeaturedComp c={featured} />}
          {rest.length > 0 && (
            <div className="grid grid-2">
              {rest.map((c, i) => {
                const href = safeHref(c.url);
                return (
                  <Card key={c.id} className="comp-card pop-in" style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}>
                    <div className="card-row">
                      <h3 style={{ margin: 0 }}>{c.title}</h3>
                      {c.category && <Badge tone="gray">{c.category}</Badge>}
                    </div>
                    {c.description && <p style={{ margin: '0.5rem 0' }}>{c.description}</p>}
                    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      {c.prize && <Badge tone="green"><span className="icon-label"><Icon name="trophy" size={12} /> {c.prize}</span></Badge>}
                      <DeadlineBadge deadline={c.deadline} />
                    </div>
                    {href && <p style={{ marginTop: '0.7rem', marginBottom: 0 }}><a className="btn btn-primary btn-sm" href={href} target="_blank" rel="noreferrer">Learn more →</a></p>}
                    <p className="muted" style={{ fontSize: '0.76rem', marginTop: '0.5rem', marginBottom: 0 }}>Posted by {c.postedByName}</p>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Hero treatment for the marquee competition.
function FeaturedComp({ c }) {
  const href = safeHref(c.url);
  return (
    <div className="comp-hero pop-in">
      <div className="comp-hero-glow" aria-hidden="true" />
      <div className="comp-hero-body">
        <span className="comp-hero-tag"><span className="icon-label"><Icon name="star" size={14} /> Featured opportunity</span></span>
        <h2 className="comp-hero-title">{c.title}</h2>
        {c.description && <p className="comp-hero-desc">{c.description}</p>}
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', marginBottom: href ? '1rem' : 0 }}>
          {c.category && <Badge tone="gray">{c.category}</Badge>}
          {c.prize && <Badge tone="green"><span className="icon-label"><Icon name="trophy" size={12} /> {c.prize}</span></Badge>}
          <DeadlineBadge deadline={c.deadline} />
        </div>
        {href && <a className="btn btn-primary" href={href} target="_blank" rel="noreferrer">Learn more →</a>}
        <p className="muted" style={{ fontSize: '0.76rem', marginTop: '0.7rem', marginBottom: 0 }}>Posted by {c.postedByName}</p>
      </div>
    </div>
  );
}
