import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Card, Badge, EmptyState } from '../../components/ui.jsx';
import { imageSrc } from '../../files.js';

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const AUDIENCE_LABEL = { all: 'Everyone', researchers: 'Researchers', editors: 'Staff' };

// Announcements & news from the Synthica team — the richer, full-page view.
export default function News({ embedded }) {
  const [news, setNews] = useState(null);
  useEffect(() => { api.news().then(setNews).catch(() => setNews([])); }, []);
  if (!news) return <div className="page-loading">Loading…</div>;

  const [featured, ...rest] = news;

  return (
    <div>
      {!embedded && <h1 className="page-title">News &amp; announcements</h1>}
      {!embedded && <p className="page-sub">The latest from the Synthica team — partnerships, programs, and platform updates.</p>}

      {news.length === 0 ? (
        <EmptyState>No announcements yet — check back soon.</EmptyState>
      ) : (
        <>
          {featured && <NewsItem item={featured} featured />}
          {rest.length > 0 && (
            <div className="grid grid-2" style={{ marginTop: '1rem' }}>
              {rest.map((n) => <NewsItem key={n.id} item={n} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewsItem({ item, featured }) {
  const banner = item.bannerUrl ? imageSrc(item.bannerUrl) : '';
  return (
    <Card style={featured ? { padding: 0, overflow: 'hidden' } : undefined}>
      {banner && (
        <img
          src={banner}
          alt=""
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ width: '100%', height: featured ? 220 : 150, objectFit: 'cover', display: 'block' }}
        />
      )}
      <div style={featured ? { padding: '1.4rem 1.5rem' } : undefined}>
        <div className="row" style={{ gap: '0.4rem', marginBottom: '0.3rem' }}>
          {featured && <Badge tone="gold">Latest</Badge>}
          {item.audience && item.audience !== 'all' && <Badge tone="blue">{AUDIENCE_LABEL[item.audience] || item.audience}</Badge>}
          <span className="muted" style={{ fontSize: '0.78rem' }}>{fmt(item.at)}</span>
        </div>
        <h3 style={{ margin: '0 0 0.4rem', fontSize: featured ? '1.3rem' : '1.05rem' }}>{item.title}</h3>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--slate)' }}>{item.body}</p>
        {item.authorName && <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>— {item.authorName}</p>}
      </div>
    </Card>
  );
}
