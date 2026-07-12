import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const CATS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');
const authorLine = (p) => { const a = (p.authors || []).map((x) => x.name); return a.length > 3 ? `${a.slice(0, 3).join(', ')}, et al.` : a.join(', '); };

// Synthica Archive — the public, searchable record of every published paper,
// dressed in the same journal chrome as /journal and /preprints.
export default function Archive() {
  const [params] = useSearchParams();
  const [pubs, setPubs] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(params.get('subject') || '');

  const load = useCallback(() => api.publications().then(setPubs).catch(() => setPubs([])), []);
  useEffect(() => { load(); }, [load]);

  // No promotional hero here — the archive's job is finding a paper, so it's
  // one uniform, scannable list. Featured papers sort first and get a badge.
  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return (pubs || [])
      .filter((p) => (!cat || p.category === cat))
      .filter((p) => !needle || p.title.toLowerCase().includes(needle) || authorLine(p).toLowerCase().includes(needle) || (p.doi || '').toLowerCase().includes(needle) || (p.keywords || []).some((k) => k.toLowerCase().includes(needle)))
      .sort((a, b) => (b.featured === true) - (a.featured === true) || new Date(b.publishedAt) - new Date(a.publishedAt));
  }, [pubs, q, cat]);
  const filtering = Boolean(q || cat);

  return (
    <div className="jr-page">
      <JournalMast />
      <main className="jr-body">
        <div className="jr-strap">
          <div>
            <h1 className="jr-title">Archive</h1>
            <p className="jr-sub">Every published paper — open access, free to read and cite{pubs ? ` · ${pubs.length} article${pubs.length === 1 ? '' : 's'}` : ''}.</p>
          </div>
        </div>

        <div className="row" style={{ margin: '0 0 1.5rem', gap: '0.6rem', flexWrap: 'wrap' }}>
          <input placeholder="Search title, author, keyword, or DOI" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All subjects</option>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
          {pubs && filtering && (
            <span className="muted" role="status">{shown.length} result{shown.length === 1 ? '' : 's'}</span>
          )}
        </div>

        {!pubs ? <div className="page-loading">Loading…</div> : (
          <>
            {shown.length === 0 ? (
              <p className="muted">No papers match — try a different search.</p>
            ) : (
              <div className="jr-toc">
                {shown.map((p) => (
                  <article key={p.id || p.doi} className="jr-art">
                    <div className="jr-art-meta">
                      {p.featured && <span className="jr-pill-feat"><Icon name="star" size={11} /> Featured</span>}
                      <span className="jr-art-type">{p.articleType || 'Article'}</span>
                      {p.openAccess !== false && <span className="jr-oa sm">Open Access</span>}
                      <span className="muted">{fmtDate(p.publishedAt)}</span>
                    </div>
                    <h3 className="jr-art-title"><Link to={`/article/${p.id || p.doi}`}>{p.title}</Link></h3>
                    <p className="jr-art-authors">{authorLine(p)}</p>
                    {p.abstract && <p className="jr-art-excerpt">{p.abstract.slice(0, 220)}{p.abstract.length > 220 ? '…' : ''}</p>}
                    <div className="jr-art-foot muted">
                      {p.category}{p.volume ? ` · Vol. ${p.volume}${p.issue ? `, Issue ${p.issue}` : ''}` : ''}{p.pages ? `, pp. ${p.pages}` : ''}
                      <span className="jr-art-doi"> · {p.doi}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <JournalFooter />
    </div>
  );
}
