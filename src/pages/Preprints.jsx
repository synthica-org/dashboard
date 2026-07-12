import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field } from '../components/ui.jsx';
import { useToast } from '../components/toast.jsx';
import Icon from '../components/Icon.jsx';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const CATS = ['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Computer Science', 'Humanities', 'Economics', 'Psychology'];
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const authorLine = (a = []) => (a.length > 3 ? `${a.slice(0, 3).map((x) => x.name).join(', ')}, et al.` : a.map((x) => x.name).join(', '));

// Synthica Preprints — author-posted, not peer-reviewed, versioned, instantly
// citable with an internal Synthica ID. Its own front door.
export default function Preprints() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => api.preprints().then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);

  const shown = (list || [])
    .filter((p) => !cat || p.category === cat)
    .filter((p) => !q.trim() || p.title.toLowerCase().includes(q.toLowerCase()) || (p.authors || []).some((a) => a.name.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="jr-page">
      <JournalMast preprint />
      <main className="jr-body">
        <div className="jr-strap">
          <div>
            <h1 className="jr-title">Synthica Preprints</h1>
            <p className="jr-sub">Share findings early. Author-posted, versioned, and citable the moment they’re live — no peer review required.</p>
          </div>
          {user && <button className="btn btn-primary" onClick={() => setPosting((v) => !v)}>{posting ? 'Cancel' : '+ Post a preprint'}</button>}
        </div>

        {posting && <PostForm onPosted={() => { setPosting(false); load(); }} />}

        <div className="row" style={{ margin: '0 0 1.25rem', gap: '0.6rem', flexWrap: 'wrap' }}>
          <input placeholder="Search preprints by title or author" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340 }} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All subjects</option>
            {CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        {!list ? <div className="page-loading">Loading…</div> : shown.length === 0 ? (
          <p className="muted">No preprints yet{user ? ' — post the first one.' : '.'}</p>
        ) : (
          <div className="jr-toc">
            {shown.map((p) => (
              <article key={p.id} className="jr-art">
                <div className="jr-art-meta">
                  <span className="jr-pre-id">{p.synId}</span>
                  <span className="badge badge-gray">Preprint</span>
                  {p.version > 1 && <span className="jr-ver-badge">v{p.version}</span>}
                  {p.linkedDoi && <span className="badge badge-green">Published</span>}
                  <span className="muted">{fmtDate(p.postedAt)}</span>
                </div>
                <h3 className="jr-art-title"><Link to={`/preprints/${p.id}`}>{p.title}</Link></h3>
                <p className="jr-art-authors">{authorLine(p.authors)}</p>
                {p.abstract && <p className="jr-art-excerpt">{p.abstract.slice(0, 220)}{p.abstract.length > 220 ? '…' : ''}</p>}
                <div className="jr-art-foot muted">{p.category}{p.accesses > 0 ? ` · ${p.accesses} views` : ''}</div>
              </article>
            ))}
          </div>
        )}
      </main>
      <JournalFooter />
    </div>
  );
}

function PostForm({ onPosted }) {
  const toast = useToast();
  const [f, setF] = useState({ title: '', category: CATS[0], abstract: '', pdfUrl: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try { await api.postPreprint(f); toast.success('Preprint posted'); onPosted(); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="jr-side-card pop-in" style={{ marginBottom: '1.5rem' }}>
      <h3 className="jr-side-h"><span className="icon-label"><Icon name="upload" size={16} /> Post a preprint</span></h3>
      <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
      <div className="grid grid-2">
        <Field label="Subject"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="PDF link"><input value={f.pdfUrl} onChange={(e) => setF({ ...f, pdfUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <Field label="Abstract"><textarea rows={4} value={f.abstract} onChange={(e) => setF({ ...f, abstract: e.target.value })} /></Field>
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>You’ll get a permanent Synthica ID. You can post new versions anytime; tagging authors works on the preprint page.</p>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post preprint'}</button>
    </form>
  );
}
