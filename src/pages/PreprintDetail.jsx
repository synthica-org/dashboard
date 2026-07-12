import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Field, Pfp } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { embedSrc, imageSrc } from '../files.js';
import { useToast } from '../components/toast.jsx';
import { JournalMast, JournalFooter } from '../components/JournalChrome.jsx';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export default function PreprintDetail() {
  const { id } = useParams();
  const [p, setP] = useState(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => api.preprint(id).then(setP).catch(() => setMissing(true)), [id]);
  useEffect(() => { setP(null); setMissing(false); load(); }, [load]);
  useEffect(() => { if (id) api.recordPreprintAccess(id).catch(() => {}); }, [id]);
  useEffect(() => { if (p?.title) document.title = `${p.title} · Synthica Preprints`; return () => { document.title = 'Synthica'; }; }, [p?.title]);

  if (missing) return <div className="jr-page"><JournalMast preprint /><div className="jr-body"><h1 className="page-title">Preprint not found</h1><Link to="/preprints">← All preprints</Link></div><JournalFooter /></div>;
  if (!p) return <div className="page-loading">Loading…</div>;

  const embed = embedSrc(p.latestPdf);

  return (
    <div className="jr-page">
      <JournalMast preprint />
      <main className="art-wrap">
        <nav className="art-crumbs"><Link to="/preprints">Preprints</Link><span>›</span><span>{p.category}</span><span>›</span><span className="muted">{p.synId}</span></nav>

        {p.linkedDoi && (
          <div className="jr-published-banner">
            <Icon name="check-circle" size={16} /> This preprint has been peer-reviewed and published in the Synthica Journal.{' '}
            {p.linkedPubId
              ? <Link to={`/article/${p.linkedPubId}`}>Read the published version →</Link>
              : <a href={`https://doi.org/${p.linkedDoi}`} target="_blank" rel="noreferrer">Read the published version →</a>}
          </div>
        )}

        <div className="art-grid">
          <article className="art-main">
            <div className="art-eyebrow">
              <span className="jr-pre-id">{p.synId}</span>
              <span className="art-type">Preprint</span>
              <span className="jr-ver-badge">Version {p.versions?.[0]?.v || 1}</span>
              <span className="muted">Posted {fmtDate(p.postedAt)}</span>
            </div>
            <h1 className="art-title">{p.title}</h1>
            <div className="art-authors">
              {(p.authors || []).map((a, i) => (
                <span key={i}>{i > 0 && ', '}{a.account ? <Link to={`/p/${a.account.slug}`}>{a.name}</Link> : a.name}</span>
              ))}
            </div>
            <div className="jr-pre-note muted">Not peer-reviewed · Posted by the authors · Citable via its Synthica ID</div>

            {p.abstract && <p className="art-lede">{p.abstract}</p>}

            <div className="art-actions">
              {p.latestPdf && <a className="btn btn-primary" href={p.latestPdf} target="_blank" rel="noreferrer"><span className="icon-label"><Icon name="external-link" size={15} /> Download PDF</span></a>}
              {p.accesses > 0 && <span className="muted" style={{ alignSelf: 'center' }}><Icon name="eye" size={14} /> {p.accesses} views</span>}
            </div>

            {embed && <iframe className="art-embed" src={embed} title={`Preview: ${p.title}`} loading="lazy" />}
          </article>

          <aside className="art-rail">
            <Card className="art-rail-card">
              <TagAccounts preprint={p} onChange={setP} />
              <h4 className="art-h4">How to cite</h4>
              <pre className="arx-cite">{(p.authors || []).map((a) => a.name).join(', ')} ({new Date(p.postedAt).getFullYear()}). {p.title}. Synthica Preprints, {p.synId}.</pre>
              <h4 className="art-h4" style={{ marginTop: '0.9rem' }}>Versions</h4>
              <div className="stack" style={{ gap: '0.5rem' }}>
                {(p.versions || []).map((v) => (
                  <div key={v.v} className="jr-ver-row">
                    <div><strong>v{v.v}</strong> <span className="muted" style={{ fontSize: '0.76rem' }}>{fmtDate(v.postedAt)}</span>{v.note && <div className="muted" style={{ fontSize: '0.78rem' }}>{v.note}</div>}</div>
                    {v.pdfUrl && <a className="btn btn-ghost btn-sm" href={v.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                  </div>
                ))}
              </div>
              {p.canEdit && <NewVersion preprintId={p.id} onChange={setP} />}
            </Card>

            {p.related?.length > 0 && (
              <Card className="art-rail-card">
                <h4 className="art-h4">Related preprints</h4>
                <div className="stack" style={{ gap: '0.6rem' }}>
                  {p.related.map((r) => (
                    <Link key={r.id} to={`/preprints/${r.id}`} className="art-related">
                      <div className="art-related-title">{r.title}</div>
                      <div className="muted" style={{ fontSize: '0.74rem' }}>{r.synId} · {fmtDate(r.postedAt)}</div>
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

function NewVersion({ preprintId, onChange }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ pdfUrl: '', note: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const d = await api.addPreprintVersion(preprintId, f); onChange(d); setF({ pdfUrl: '', note: '' }); setOpen(false); toast.success('New version posted'); }
    catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.6rem' }} onClick={() => setOpen(true)}>+ Post new version</button>;
  return (
    <form onSubmit={submit} style={{ marginTop: '0.6rem' }}>
      <Field label="New PDF link"><input value={f.pdfUrl} onChange={(e) => setF({ ...f, pdfUrl: e.target.value })} placeholder="https://…" /></Field>
      <Field label="What changed?"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. added new data" /></Field>
      <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Posting…' : 'Post version'}</button>
    </form>
  );
}

function TagAccounts({ preprint, onChange }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [people, setPeople] = useState(null);
  const [q, setQ] = useState('');
  const tagged = preprint.taggedAccounts || [];
  const taggedIds = new Set(tagged.map((t) => t.id));
  const openEditor = () => { setEditing(true); if (!people) api.people().then(setPeople).catch(() => setPeople([])); };
  const update = (body) => api.tagPreprint(preprint.id, body).then(onChange).catch((e) => toast.error(e.message));
  const matches = (people || []).filter((u) => !taggedIds.has(u.id)).filter((u) => !q.trim() || (u.name || '').toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  if (!tagged.length && !preprint.canTag) return null;
  return (
    <div className="art-tags">
      <div className="card-row" style={{ marginBottom: '0.4rem' }}>
        <h4 className="art-h4" style={{ margin: 0 }}>Tagged members</h4>
        {preprint.canTag && <button className="btn btn-ghost btn-sm" onClick={() => (editing ? setEditing(false) : openEditor())}>{editing ? 'Done' : 'Tag accounts'}</button>}
      </div>
      {tagged.length === 0 && !editing && <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>No members tagged yet.</p>}
      <div className="stack" style={{ gap: '0.4rem' }}>
        {tagged.map((t) => (
          <div key={t.id} className="art-tag-row">
            <Link to={`/p/${t.slug}`} className="row" style={{ gap: '0.45rem', alignItems: 'center', minWidth: 0 }}>
              <Pfp name={t.name} url={imageSrc(t.avatarUrl)} size="xs" />
              <span style={{ minWidth: 0 }}><span className="art-tag-name">{t.name}</span><span className="muted" style={{ fontSize: '0.72rem', display: 'block' }}>{t.role}</span></span>
            </Link>
            {editing && <button className="btn btn-ghost btn-sm" onClick={() => update({ removeUserIds: [t.id] })} aria-label="Remove"><Icon name="x" size={14} /></button>}
          </div>
        ))}
      </div>
      {editing && (
        <div style={{ marginTop: '0.5rem' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members to tag…" />
          {!people ? <p className="muted" style={{ fontSize: '0.8rem' }}>Loading…</p> : (
            <div className="stack" style={{ gap: '0.25rem', marginTop: '0.4rem' }}>
              {matches.length === 0 ? <p className="muted" style={{ fontSize: '0.8rem' }}>No matches.</p> : matches.map((u) => (
                <button key={u.id} type="button" className="art-tag-pick" onClick={() => update({ addUserIds: [u.id] })}>
                  <Pfp name={u.name} url={imageSrc(u.avatarUrl)} size="xs" />
                  <span style={{ flex: 1, textAlign: 'left' }}>{u.name}</span><Icon name="plus" size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
