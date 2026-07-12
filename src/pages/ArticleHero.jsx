import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Badge, Pfp } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { embedSrc, imageSrc } from '../files.js';
import { useToast } from '../components/toast.jsx';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

// Citation strings in the formats people actually paste.
function citations(p) {
  const year = new Date(p.publishedAt).getFullYear();
  const authors = p.authors || [];
  const apaNames = authors.map((a) => {
    const parts = (a.name || '').trim().split(/\s+/);
    const last = parts.pop();
    return `${last}, ${parts.map((n) => n[0] + '.').join(' ')}`;
  }).join(', ');
  const vol = p.volume ? `${p.volume}${p.issue ? `(${p.issue})` : ''}` : '';
  const apa = `${apaNames} (${year}). ${p.title}. Synthica Journal${vol ? `, ${vol}` : ''}${p.pages ? `, ${p.pages}` : ''}. https://doi.org/${p.doi}`;
  const bibtex = `@article{${(authors[0]?.name || 'synthica').split(' ').pop().toLowerCase()}${year},
  title   = {${p.title}},
  author  = {${authors.map((a) => a.name).join(' and ')}},
  journal = {Synthica Journal},${p.volume ? `\n  volume  = {${p.volume}},` : ''}${p.issue ? `\n  number  = {${p.issue}},` : ''}${p.pages ? `\n  pages   = {${p.pages}},` : ''}
  year    = {${year}},
  doi     = {${p.doi}}
}`;
  return { APA: apa, BibTeX: bibtex };
}

// Nature/IEEE-style article hero page. Public (no login), with a sticky metadata
// + actions rail. Authors and staff get inline account-tagging.
export default function ArticleHero() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => api.article(id).then(setP).catch(() => setMissing(true)), [id]);
  useEffect(() => { setP(null); setMissing(false); load(); }, [load]);
  useEffect(() => { if (id) api.recordPublicationAccess(id).catch(() => {}); }, [id]);
  useEffect(() => { if (p?.title) { document.title = `${p.title} · Synthica Journal`; } return () => { document.title = 'Synthica'; }; }, [p?.title]);

  if (missing) return <div className="jr-page"><JournalMast /><div className="jr-body"><h1 className="page-title">Article not found</h1><Link to="/journal">← Back to the Journal</Link></div><JournalFooter /></div>;
  if (!p) return <div className="page-loading">Loading…</div>;

  const embed = embedSrc(p.pdfUrl);

  return (
    <div className="jr-page">
      <JournalMast />

      <main className="art-wrap">
        {/* breadcrumb */}
        <nav className="art-crumbs">
          <Link to="/archive">Synthica</Link><span>›</span>
          <Link to="/archive">Journal</Link><span>›</span>
          <span>{p.category}</span><span>›</span>
          <span className="muted">{p.articleType || 'Article'}</span>
        </nav>

        <div className="art-grid">
          <article className="art-main">
            <div className="art-eyebrow">
              <span className="art-type">{p.articleType || 'Article'}</span>
              {p.openAccess !== false && <span className="art-oa">Open Access</span>}
              <span className="muted">Published {fmtDate(p.publishedAt)}</span>
            </div>

            <h1 className="art-title">{p.title}</h1>

            <div className="art-authors">
              {(p.authors || []).map((a, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  {a.account ? <Link to={`/p/${a.account.slug}`}>{a.name}</Link> : a.name}
                </span>
              ))}
            </div>
            {p.authors?.some((a) => a.affiliation) && (
              <div className="muted art-affil">{[...new Set(p.authors.map((a) => a.affiliation).filter(Boolean))].join(' · ')}</div>
            )}

            {p.abstract && <p className="art-lede">{p.abstract}</p>}

            <div className="art-actions">
              {p.pdfUrl && <a className="btn btn-primary" href={p.pdfUrl} target="_blank" rel="noreferrer"><span className="icon-label"><Icon name="external-link" size={15} /> Read / Download PDF</span></a>}
              {String(p.doi || '').startsWith('10.') && <a className="btn btn-ghost" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">View at doi.org</a>}
              {typeof p.metrics?.accesses === 'number' && <span className="muted" style={{ alignSelf: 'center' }}><Icon name="eye" size={14} /> {p.metrics.accesses} views</span>}
            </div>

            {embed && <iframe className="art-embed" src={embed} title={`Preview: ${p.title}`} loading="lazy" />}

            {(p.sections || []).filter((s) => s.body).map((s, i) => (
              <section key={i} className="art-section">
                {s.heading && <h2>{s.heading}</h2>}
                <p>{s.body}</p>
              </section>
            ))}
          </article>

          <aside className="art-rail">
            <Card className="art-rail-card">
              <PreprintLink article={p} onChange={setP} />
              <TagAccounts article={p} onChange={setP} />
              <Metadata p={p} />
              <CiteBox p={p} />
            </Card>

            {p.related?.length > 0 && (
              <Card className="art-rail-card">
                <h4 className="art-h4">Related articles</h4>
                <div className="stack" style={{ gap: '0.6rem' }}>
                  {p.related.map((r) => (
                    <Link key={r.id} to={`/article/${r.id}`} className="art-related">
                      <Badge tone="blue">{r.category}</Badge>
                      <div className="art-related-title">{r.title}</div>
                      <div className="muted" style={{ fontSize: '0.74rem' }}>{fmtDate(r.publishedAt)}</div>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </aside>
        </div>
      </main>
      <JournalFooter />
    </div>
  );
}

// Shows the linked preprint, or (for authors/staff) lets you link one.
function PreprintLink({ article, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');

  if (article.preprint) {
    return (
      <div className="art-preprint-link">
        <h4 className="art-h4" style={{ margin: '0 0 0.4rem' }}>Preprint</h4>
        <Link to={`/preprints/${article.preprint.id}`} className="art-related" style={{ display: 'block' }}>
          <span className="jr-pre-id">{article.preprint.synId}</span>
          <div className="muted" style={{ fontSize: '0.78rem' }}>Earlier version{article.preprint.version > 1 ? ` (v${article.preprint.version})` : ''} → view preprint</div>
        </Link>
      </div>
    );
  }
  if (!article.canTag) return null;

  const open = () => { setEditing(true); if (!list) api.preprints().then(setList).catch(() => setList([])); };
  const link = (preprintId) =>
    api.linkPreprint(article.id, preprintId).then(onChange).then(() => toast.success('Preprint linked')).catch((e) => toast.error(e.message));
  const matches = (list || []).filter((p) => !p.linkedDoi).filter((p) => !q.trim() || p.title.toLowerCase().includes(q.toLowerCase())).slice(0, 6);

  return (
    <div className="art-preprint-link">
      <div className="card-row" style={{ marginBottom: '0.4rem' }}>
        <h4 className="art-h4" style={{ margin: 0 }}>Preprint</h4>
        <button className="btn btn-ghost btn-sm" onClick={() => (editing ? setEditing(false) : open())}>{editing ? 'Done' : 'Link a preprint'}</button>
      </div>
      {editing && (
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search preprints…" />
          {!list ? <p className="muted" style={{ fontSize: '0.8rem' }}>Loading…</p> : (
            <div className="stack" style={{ gap: '0.25rem', marginTop: '0.4rem' }}>
              {matches.length === 0 ? <p className="muted" style={{ fontSize: '0.8rem' }}>No unlinked preprints.</p> : matches.map((p) => (
                <button key={p.id} type="button" className="art-tag-pick" onClick={() => link(p.id)}>
                  <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span className="jr-pre-id">{p.synId}</span>
                    <span style={{ display: 'block', fontSize: '0.82rem' }}>{p.title.slice(0, 60)}{p.title.length > 60 ? '…' : ''}</span>
                  </span>
                  <Icon name="link" size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metadata({ p }) {
  return (
    <>
      <h4 className="art-h4">Metadata</h4>
      <dl className="arx-dl">
        <dt>Published</dt><dd>{fmtDate(p.publishedAt)}</dd>
        {p.acceptedAt && <><dt>Accepted</dt><dd>{fmtDate(p.acceptedAt)}</dd></>}
        <dt>Type</dt><dd>{p.articleType || 'Article'}</dd>
        <dt>Subject</dt><dd>{p.category}</dd>
        <dt>DOI</dt><dd className="arx-break">{p.doi}</dd>
        {p.volume ? <><dt>Volume</dt><dd>{p.volume}{p.issue ? ` (${p.issue})` : ''}</dd></> : null}
        {p.pages ? <><dt>Pages</dt><dd>{p.pages}</dd></> : null}
        <dt>License</dt><dd>{p.license || 'CC BY 4.0'}</dd>
      </dl>
    </>
  );
}

function CiteBox({ p }) {
  const [tab, setTab] = useState('APA');
  const [copied, setCopied] = useState(false);
  const cites = useMemo(() => citations(p), [p]);
  const copy = () => navigator.clipboard?.writeText(cites[tab]).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <>
      <h4 className="art-h4" style={{ marginTop: '0.9rem' }}>Cite this article</h4>
      <div className="seg" style={{ marginBottom: '0.45rem' }}>
        {Object.keys(cites).map((k) => <button key={k} type="button" className={`seg-btn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{k}</button>)}
      </div>
      <pre className="arx-cite">{cites[tab]}</pre>
      <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? <span className="icon-label"><Icon name="check" size={14} /> Copied</span> : 'Copy citation'}</button>
    </>
  );
}

// Tagged Synthica accounts + (for authors/staff) an inline picker to add/remove.
function TagAccounts({ article, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [people, setPeople] = useState(null);
  const [q, setQ] = useState('');
  const tagged = article.taggedAccounts || [];
  const taggedIds = new Set(tagged.map((t) => t.id));

  const openEditor = () => {
    setEditing(true);
    if (!people) api.people().then(setPeople).catch(() => setPeople([]));
  };

  const update = (body) =>
    api.tagPublication(article.id, body).then(onChange).catch((e) => toast.error(e.message));
  const add = (id) => update({ addUserIds: [id] });
  const remove = (id) => update({ removeUserIds: [id] });

  const matches = (people || [])
    .filter((u) => !taggedIds.has(u.id))
    .filter((u) => !q.trim() || (u.name || '').toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6);

  if (!tagged.length && !article.canTag) return null;

  return (
    <div className="art-tags">
      <div className="card-row" style={{ marginBottom: '0.4rem' }}>
        <h4 className="art-h4" style={{ margin: 0 }}>Tagged members</h4>
        {article.canTag && <button className="btn btn-ghost btn-sm" onClick={() => (editing ? setEditing(false) : openEditor())}>{editing ? 'Done' : 'Tag accounts'}</button>}
      </div>

      {tagged.length === 0 && !editing && <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>No members tagged yet.</p>}

      <div className="stack" style={{ gap: '0.4rem' }}>
        {tagged.map((t) => (
          <div key={t.id} className="art-tag-row">
            <Link to={`/p/${t.slug}`} className="row" style={{ gap: '0.45rem', alignItems: 'center', minWidth: 0 }}>
              <Pfp name={t.name} url={imageSrc(t.avatarUrl)} size="xs" />
              <span style={{ minWidth: 0 }}><span className="art-tag-name">{t.name}</span><span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>{t.role}</span></span>
            </Link>
            {editing && <button className="btn btn-ghost btn-sm" onClick={() => remove(t.id)} aria-label="Remove"><Icon name="x" size={14} /></button>}
          </div>
        ))}
      </div>

      {editing && (
        <div style={{ marginTop: '0.5rem' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members to tag…" />
          {!people ? <p className="muted" style={{ fontSize: '0.8rem' }}>Loading…</p> : (
            <div className="stack" style={{ gap: '0.25rem', marginTop: '0.4rem' }}>
              {matches.length === 0 ? <p className="muted" style={{ fontSize: '0.8rem' }}>No matches.</p> : matches.map((u) => (
                <button key={u.id} type="button" className="art-tag-pick" onClick={() => add(u.id)}>
                  <Pfp name={u.name} url={imageSrc(u.avatarUrl)} size="xs" />
                  <span style={{ flex: 1, textAlign: 'left' }}>{u.name}</span>
                  <Icon name="plus" size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
