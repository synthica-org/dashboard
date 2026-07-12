import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Badge } from './ui.jsx';
import Icon from './Icon.jsx';

// Global announcements feed, shown on everyone's home. Compact by default.
export default function NewsFeed({ limit = 3 }) {
  const [news, setNews] = useState([]);
  useEffect(() => {
    api.news().then(setNews).catch(() => {});
  }, []);
  if (!news.length) return null;
  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <div className="card-row">
        <h3><span className="icon-label"><Icon name="megaphone" size={18} /> Announcements</span></h3>
        <Badge tone="gray">{news.length}</Badge>
      </div>
      <div className="stack" style={{ marginTop: '0.5rem' }}>
        {news.slice(0, limit).map((n) => (
          <div key={n.id} className="info-block">
            <strong>{n.title}</strong>
            <div style={{ marginTop: '0.2rem' }}>{n.body}</div>
            <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {n.authorName} · {new Date(n.at).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
