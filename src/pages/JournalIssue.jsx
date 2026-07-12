import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const authorLine = (a = []) => (a.length > 4 ? `${a.slice(0, 4).join(', ')}, et al.` : a.join(', '));

// One issue, as a classic table of contents.
export default function JournalIssue() {
  const { volume, issue } = useParams();
  const [d, setD] = useState(null);
  useEffect(() => { setD(null); api.journalIssue(volume, issue).then(setD).catch(() => setD({ articles: [] })); }, [volume, issue]);

  return (
    <div className="jr-page">
      <JournalMast />
      <main className="jr-body">
        <nav className="art-crumbs">
          <Link to="/journal">Journal</Link><span>›</span>
          <Link to="/journal/volumes">Volumes</Link><span>›</span>
          <span>Volume {volume}, Issue {issue}</span>
        </nav>

        <div className="jr-issue-head">
          <span className="jr-issue-eyebrow">Synthica Journal</span>
          <h1 className="jr-title">Volume {volume}, Issue {issue}</h1>
          {d && <p className="jr-sub">{d.count} article{d.count === 1 ? '' : 's'} in this issue.</p>}
        </div>

        {!d ? <div className="page-loading">Loading…</div> : d.articles.length === 0 ? (
          <p className="muted">No articles in this issue.</p>
        ) : (
          <div className="jr-toc jr-toc-issue">
            {d.articles.map((p) => (
              <article key={p.id} className="jr-art">
                <div className="jr-art-meta">
                  <span className="jr-art-type">{p.articleType}</span>
                  {p.openAccess && <span className="jr-oa sm">Open Access</span>}
                  {p.pages && <span className="muted">pp. {p.pages}</span>}
                  <span className="muted">{fmtDate(p.publishedAt)}</span>
                </div>
                <h3 className="jr-art-title"><Link to={`/article/${p.id}`}>{p.title}</Link></h3>
                <p className="jr-art-authors">{authorLine(p.authors)}</p>
                {p.abstract && <p className="jr-art-excerpt">{p.abstract.slice(0, 240)}{p.abstract.length > 240 ? '…' : ''}</p>}
                <div className="jr-art-foot">
                  <Link to={`/article/${p.id}`} className="btn btn-ghost btn-sm">Read article →</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <JournalFooter />
    </div>
  );
}
