import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api } from '../../api.js';
import { Card, Badge, Button, EmptyState, ErrorState, Field, Modal, Loading } from '../../components/ui.jsx';
import { useToast } from '../../components/toast.jsx';
import Icon from '../../components/Icon.jsx';

// ---------------------------------------------------------------------------
// Director Desk — the top of the editorial pipeline.
//
// Three jobs, three sections (JOURNAL_PIPELINE §9.6):
//   1. Current issue     — the open journal issue: its articles, a close action
//                          (stamps the publication date, opens the next issue),
//                          per-issue Crossref XML, and per-article issue moves.
//                          Feature-detected: until the issue-lifecycle backend
//                          lands, this section is a quiet one-line note.
//   2. Papers to email   — every approve/reject decision across all stages.
//                          The Director emails the author, then marks it sent.
//   3. Papers to publish — Chief-approved papers. "Mark published" mints a DOI,
//                          creates the public Publication, and notifies everyone.
// Supporting panels: editor workload, reviews-editor reassignment, and the
// Discord webhook used for live queue notifications.
// ---------------------------------------------------------------------------

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const fmtDay = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

// Trigger a browser download for a Blob. Attached to the DOM for Firefox, and
// the object URL is revoked on a delay — Safari can cancel a download whose
// URL dies in the same tick.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Download the "papers to email" list (respecting the active filter) as CSV.
function exportEmailsCsv(rows) {
  const head = ['Paper ID', 'Title', 'Author', 'Author email', 'Category', 'Stage', 'Decision', 'Decided at', 'Emailed', 'Emailed at'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map((e) =>
    [e.paperId, e.title, e.authorName, e.authorEmail, e.category, e.state, e.decision, e.at, e.emailed ? 'yes' : 'no', e.emailedAt || ''].map(esc).join(',')
  );
  const csv = [head.join(','), ...body].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `synthica-papers-to-email-${new Date().toISOString().slice(0, 10)}.csv`);
}

// A compact metric tile for the "act now" header.
function Stat({ label, value, tone = 'blue' }) {
  return (
    <div className="dd-stat">
      <span className={`dd-stat-num dd-stat-${tone}`}>{value}</span>
      <span className="dd-stat-label">{label}</span>
    </div>
  );
}

// === Journal issues (issue lifecycle) ======================================
// Everything below talks to the issue-lifecycle endpoints (journal meta +
// issues). Those ship in a separate backend unit — until it's merged the two
// bootstrap calls fail, the page flips to the 'absent' state, and this whole
// section renders as one quiet note. The rest of the desk never notices.

const issueLabel = (v, i) => `Vol ${v} · Issue ${i}`;

// Where an article lives on the public journal site: ${journalUrl}/articles/<slug>
// per the journal contract, or the journal root while the slug is unknown
// (today's publish response carries no slug — the root link still lands
// somewhere sensible).
function journalArticleUrl(meta, slug) {
  if (!meta?.journalUrl) return '';
  const base = String(meta.journalUrl).replace(/\/$/, '');
  return slug ? `${base}/articles/${encodeURIComponent(slug)}` : base;
}

// Per-issue "Download Crossref XML". fetch + blob (not a bare link) so the
// Authorization header rides along with the request.
function CrossrefButton({ volume, issue }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const blob = await api.directorCrossrefXml({ volume, issue });
      downloadBlob(blob, `synthica-crossref-vol${volume}-issue${issue}.xml`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="ghost" size="btn-sm" icon="download" onClick={go} disabled={busy}>
      {busy ? 'Preparing…' : 'Crossref XML'}
    </Button>
  );
}

// Move one published article into another existing issue. `from` is the issue
// this article currently sits in (the article rows themselves may not repeat
// their issue coordinates).
function MoveArticleControl({ article, from, issues, onMoved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const targets = issues.filter((t) => !(t.volume === from.volume && t.issue === from.issue));
  if (!targets.length) return null;

  const move = async (value) => {
    const [volume, issue] = value.split(':').map(Number);
    setBusy(true);
    try {
      await api.moveArticleToIssue({ publicationId: article.id, volume, issue });
      toast.success(`Moved “${article.title}” to ${issueLabel(volume, issue)}.`);
      onMoved();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      className="dd-move"
      defaultValue=""
      disabled={busy}
      aria-label={`Move “${article.title}” to another issue`}
      onChange={(e) => {
        const v = e.target.value;
        e.target.value = ''; // snap back to the placeholder
        if (v) move(v);
      }}
    >
      <option value="" disabled>Move to…</option>
      {targets.map((t) => (
        <option key={`${t.volume}:${t.issue}`} value={`${t.volume}:${t.issue}`}>
          {issueLabel(t.volume, t.issue)}{t.status === 'closed' ? ' (closed)' : ''}
        </option>
      ))}
    </select>
  );
}

// The open issue: header, its articles (title · DOI · pages · move control),
// Close issue (with confirm), and the issue's Crossref XML download.
// `current` is derived once at the page level so the publish form and this
// card can never disagree about which issue is open.
function CurrentIssueCard({ current, issues, onChanged }) {
  const toast = useToast();
  const [articles, setArticles] = useState(null); // null = not loaded yet
  const [articlesError, setArticlesError] = useState(false);
  const [detailTick, setDetailTick] = useState(0); // bump to retry the detail fetch
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const loadedKey = useRef('');

  useEffect(() => {
    if (!current) return;
    let stale = false;
    // Refreshes keep the previous list on screen (no loading flash); only a
    // genuinely different issue resets to the loading state.
    const key = `${current.volume}:${current.issue}`;
    if (key !== loadedKey.current) {
      loadedKey.current = key;
      setArticles(null);
      setArticlesError(false);
    }
    api.journalIssueDetail(current.volume, current.issue)
      .then((d) => { if (!stale) { setArticles(Array.isArray(d.articles) ? d.articles : []); setArticlesError(false); } })
      .catch(() => { if (!stale) setArticlesError(true); });
    return () => { stale = true; };
  }, [current, detailTick]);

  if (!current) {
    return <EmptyState>No open issue right now — issue history and Crossref downloads are in the list below.</EmptyState>;
  }

  // A failed detail fetch must not report the issue as empty — fall back to
  // the count the issues list gave us.
  const count = articles ? articles.length : current.articleCount ?? 0;
  const next = issueLabel(current.volume, Number(current.issue) + 1);

  const doClose = async () => {
    setClosing(true);
    try {
      const res = await api.closeCurrentIssue();
      const opened = res?.opened;
      toast.success(
        opened?.volume != null && opened?.issue != null
          ? `${issueLabel(current.volume, current.issue)} closed — ${issueLabel(opened.volume, opened.issue)} is now open.`
          : `${issueLabel(current.volume, current.issue)} closed.`
      );
      setConfirming(false);
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setClosing(false);
    }
  };

  return (
    <Card className="dd-issue-card">
      <div className="card-row">
        <h3>Volume {current.volume} · Issue {current.issue}</h3>
        <Badge tone="green">open</Badge>
      </div>
      <p className="muted dd-panel-sub">
        {count} article{count === 1 ? '' : 's'} so far — newly published papers land here until the issue is closed.
      </p>

      {articles === null && articlesError ? (
        <ErrorState title="Couldn't load this issue's articles" onRetry={() => setDetailTick((t) => t + 1)}>
          The issues list still works — try again in a moment.
        </ErrorState>
      ) : articles === null ? (
        <Loading inline>Loading articles…</Loading>
      ) : (
        <>
          {articles.length === 0 ? (
            <p className="muted">No articles in this issue yet — publish a paper below to add the first one.</p>
          ) : (
            <table className="dd-table dd-issue-articles">
              <thead>
                <tr><th>Article</th><th>DOI</th><th className="dd-num">Pages</th><th className="dd-action" /></tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.id}>
                    <td><div className="dd-title">{a.title}</div></td>
                    <td><code className="dd-doi">{a.doi}</code></td>
                    <td className="dd-num muted">{a.pages || '—'}</td>
                    <td className="dd-action">
                      <MoveArticleControl article={a} from={current} issues={issues} onMoved={onChanged} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {articlesError && <p className="muted">Couldn't refresh the article list just now — showing the last known state.</p>}
        </>
      )}

      <div className="row dd-issue-actions">
        <Button size="btn-sm" icon="check-circle" onClick={() => setConfirming(true)}>Close issue</Button>
        <CrossrefButton volume={current.volume} issue={current.issue} />
      </div>

      {confirming && (
        <Modal title={`Close Volume ${current.volume} · Issue ${current.issue}?`} onClose={() => setConfirming(false)}>
          <p>
            Closing stamps the publication date on its {count} article{count === 1 ? '' : 's'} and opens the next
            issue (<strong>{next}</strong>) for newly published papers.
          </p>
          <p className="muted">Articles stay live in the Archive — this only finalises the issue itself.</p>
          <div className="row">
            <Button onClick={doClose} disabled={closing}>{closing ? 'Closing…' : 'Close issue'}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={closing}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// Every issue, open + closed, behind a collapsible — each with its own
// Crossref XML download.
function AllIssuesList({ issues }) {
  if (!issues.length) return null;
  return (
    <details className="dd-issues-all" style={{ marginTop: '0.75rem' }}>
      <summary className="muted">All issues ({issues.length}) — Crossref XML per issue</summary>
      <Card className="dd-table-card" style={{ marginTop: '0.5rem' }}>
        <table className="dd-table">
          <thead>
            <tr><th>Issue</th><th>Status</th><th className="dd-num">Articles</th><th className="dd-num">Published</th><th className="dd-action" /></tr>
          </thead>
          <tbody>
            {issues.map((it) => (
              <tr key={`${it.volume}-${it.issue}`}>
                <td><div className="dd-title">{issueLabel(it.volume, it.issue)}</div></td>
                <td><Badge tone={it.status === 'open' ? 'green' : 'gray'}>{it.status}</Badge></td>
                <td className="dd-num muted">{it.articleCount ?? 0}</td>
                <td className="dd-num muted">{it.publishedAt ? fmtDay(it.publishedAt) : '—'}</td>
                <td className="dd-action"><CrossrefButton volume={it.volume} issue={it.issue} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </details>
  );
}

// The whole "Current issue" section: loading line → quiet absence note (the
// endpoints 404 until the issue-lifecycle backend merges) → retryable error →
// current-issue card + collapsible all-issues list.
function IssuesSection({ journal, current, onRefresh }) {
  if (journal.state === 'loading') {
    return (
      <section style={{ marginBottom: '2rem' }}>
        <Loading inline>Checking journal issues…</Loading>
      </section>
    );
  }
  if (journal.state === 'absent') {
    return (
      <p className="muted dd-issues-absent" style={{ marginBottom: '2rem' }}>
        <Icon name="info" size={14} /> Issue management unlocks once the journal issues backend lands.
      </p>
    );
  }
  if (journal.state === 'error') {
    return (
      <section style={{ marginBottom: '2rem' }}>
        <ErrorState title="Couldn't load journal issues" onRetry={onRefresh}>
          The issue endpoints answered with an error — the rest of the desk still works.
        </ErrorState>
      </section>
    );
  }
  const { meta, issues } = journal;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="dd-section-head">
        <h2 className="section-title">
          Current issue {meta?.issn && <Badge tone="gray">ISSN {meta.issn}</Badge>}
        </h2>
      </div>
      <p className="muted dd-section-sub">
        Publishing adds papers to the open issue. Closing it stamps the publication date and opens the next one.
      </p>
      {issues.length === 0 ? (
        <EmptyState>No issues yet — the first one opens with the journal.</EmptyState>
      ) : (
        <>
          <CurrentIssueCard current={current} issues={issues} onChanged={onRefresh} />
          <AllIssuesList issues={issues} />
        </>
      )}
    </section>
  );
}

// === Papers to email =======================================================
function EmailQueue({ rows, onMarkEmailed }) {
  const [stage, setStage] = useState('all');
  const [decision, setDecision] = useState('all');
  const [hideEmailed, setHideEmailed] = useState(true);

  const stages = useMemo(() => Array.from(new Set(rows.map((r) => r.state))).sort(), [rows]);
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (stage === 'all' || r.state === stage) &&
          (decision === 'all' || r.decision === decision) &&
          (!hideEmailed || !r.emailed)
      ),
    [rows, stage, decision, hideEmailed]
  );
  const pending = rows.filter((r) => !r.emailed).length;

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="card-row dd-section-head">
        <h2 className="section-title">
          Papers to email <Badge tone={pending ? 'gold' : 'gray'}>{pending} to send</Badge>
        </h2>
        {rows.length > 0 && (
          <Button variant="ghost" size="btn-sm" onClick={() => exportEmailsCsv(filtered)}>
            Export CSV
          </Button>
        )}
      </div>
      <p className="muted dd-section-sub">
        Every approve/reject decision in the pipeline lands here. Email the author the outcome, then mark it sent.
      </p>

      {rows.length > 0 && (
        <div className="row dd-filters">
          <label className="dd-filter">
            <span>Stage</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="all">All stages</option>
              {stages.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="dd-filter">
            <span>Decision</span>
            <select value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="declined">Declined</option>
            </select>
          </label>
          <label className="dd-check">
            <input type="checkbox" checked={hideEmailed} onChange={(e) => setHideEmailed(e.target.checked)} />
            <span>Hide already-emailed</span>
          </label>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>No decisions yet — author emails will appear here as papers are reviewed.</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>Nothing matches these filters{hideEmailed ? ' — every decision has been emailed. 🎉' : '.'}</EmptyState>
      ) : (
        <Card className="dd-table-card">
          <table className="dd-table">
            <thead>
              <tr>
                <th>Paper</th>
                <th>Author</th>
                <th>Stage</th>
                <th>Decision</th>
                <th className="dd-num">Decided</th>
                <th className="dd-action" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={`${e.paperId}-${e.at}`} className={e.emailed ? 'dd-done' : ''}>
                  <td>
                    <div className="dd-title">{e.title}</div>
                    <div className="dd-id muted">{e.paperId} · {e.category}</div>
                  </td>
                  <td>
                    <div>{e.authorName}</div>
                    <a className="dd-email" href={`mailto:${e.authorEmail}?subject=${encodeURIComponent(`Your Synthica submission: ${e.title}`)}`}>
                      {e.authorEmail}
                    </a>
                  </td>
                  <td><span className="dd-stage">{e.state}</span></td>
                  <td>
                    <Badge tone={e.decision === 'approved' ? 'green' : 'red'}>{e.decision}</Badge>
                  </td>
                  <td className="dd-num muted">{fmtDay(e.at)}</td>
                  <td className="dd-action">
                    {e.emailed ? (
                      <span className="dd-emailed muted" title={fmtDate(e.emailedAt)}>✓ emailed</span>
                    ) : (
                      <Button size="btn-sm" onClick={() => onMarkEmailed(e.paperId, e.at)}>Mark emailed</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

// === Papers to publish =====================================================
// `openIssue` (when the issue-lifecycle backend is live) is the journal's open
// issue: blank volume/issue fields publish into it explicitly, so what the UI
// promises is what the backend receives.
function PublishCard({ paper, onPublish, openIssue }) {
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState('');
  const [issue, setIssue] = useState('');
  const [pages, setPages] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      await onPublish(paper.id, {
        volume: volume ? Number(volume) : openIssue?.volume ?? undefined,
        issue: issue ? Number(issue) : openIssue?.issue ?? undefined,
        pages: pages.trim() || undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="paper-card dd-publish">
      <div className="card-row">
        <Badge>{paper.category}</Badge>
        <Badge tone="gold">ready to publish</Badge>
      </div>
      <h3>{paper.title}</h3>
      <p className="paper-meta">
        {paper.authorName} · <a href={`mailto:${paper.authorEmail}`}>{paper.authorEmail}</a>
      </p>
      {paper.abstract && <p className="dd-abstract muted">{paper.abstract}</p>}
      <div className="dd-meta-grid muted">
        <span>{paper.id}</span>
        <span>Submitted {fmtDay(paper.submittedAt)}</span>
        {paper.pdfUrl && <a href={paper.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a>}
      </div>

      {open && (
        <div className="dd-pub-form">
          <div className="row">
            <label className="dd-filter dd-pub-num">
              <span>Volume</span>
              <input type="number" min="1" value={volume} onChange={(e) => setVolume(e.target.value)} placeholder={String(openIssue?.volume ?? 1)} />
            </label>
            <label className="dd-filter dd-pub-num">
              <span>Issue</span>
              <input type="number" min="1" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder={String(openIssue?.issue ?? 1)} />
            </label>
            <label className="dd-filter">
              <span>Pages</span>
              <input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="1–8" />
            </label>
          </div>
          {openIssue?.volume != null && openIssue?.issue != null && (
            <p className="muted dd-hint">
              Leave volume/issue blank to publish into the open issue ({issueLabel(openIssue.volume, openIssue.issue)}).
            </p>
          )}
        </div>
      )}

      <div className="row dd-pub-actions">
        <Button size="btn-sm" onClick={go} disabled={busy}>
          {busy ? 'Publishing…' : 'Mark published & assign DOI'}
        </Button>
        <Button variant="ghost" size="btn-sm" onClick={() => setOpen((v) => !v)} disabled={busy}>
          {open ? 'Hide volume/issue' : 'Set volume/issue'}
        </Button>
      </div>
    </Card>
  );
}

function PublishQueue({ rows, onPublish, openIssue }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="dd-section-head">
        <h2 className="section-title">
          Papers to publish <Badge tone={rows.length ? 'gold' : 'gray'}>{rows.length}</Badge>
        </h2>
      </div>
      <p className="muted dd-section-sub">
        Chief-approved papers. Publishing mints a DOI, posts the paper to the public Archive, and notifies the author and reviewers.
      </p>
      {rows.length === 0 ? (
        <EmptyState>No papers ready to publish. Chief-approved papers will appear here.</EmptyState>
      ) : (
        <div className="grid grid-2">
          {rows.map((p) => (
            <PublishCard key={p.id} paper={p} onPublish={onPublish} openIssue={openIssue} />
          ))}
        </div>
      )}
    </section>
  );
}

// Recently published papers — confirmation that the DOI was minted + Archive
// link. Papers published this session get an inline "just published" state
// with their assigned issue and a link to the public journal (when known).
function PublishedList({ rows, lastPublished = {}, meta }) {
  if (!rows.length) return null;
  return (
    <section style={{ marginBottom: '2rem' }}>
      <div className="dd-section-head">
        <h2 className="section-title">Recently published <Badge tone="green">{rows.length}</Badge></h2>
      </div>
      <Card className="dd-table-card">
        <table className="dd-table">
          <thead>
            <tr><th>Paper</th><th>DOI</th><th className="dd-num">Published</th><th className="dd-action" /></tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const just = lastPublished[p.id];
              const journalHref = just ? journalArticleUrl(meta, just.slug) : '';
              return (
                <tr key={p.id} className={just ? 'dd-just-published' : ''}>
                  <td>
                    <div className="dd-title">
                      {p.title} {just && <Badge tone="green">just published</Badge>}
                    </div>
                    <div className="dd-id muted">{p.authorName} · {p.category}</div>
                  </td>
                  <td>
                    <code className="dd-doi">{p.doi}</code>
                    {just && just.volume != null && just.issue != null && (
                      <div className="dd-id muted">{issueLabel(just.volume, just.issue)}</div>
                    )}
                  </td>
                  <td className="dd-num muted">{fmtDay(p.publishedAt)}</td>
                  <td className="dd-action">
                    {journalHref && (
                      <a className="btn btn-ghost btn-sm" href={journalHref} target="_blank" rel="noreferrer">
                        <Icon name="external-link" size={14} /> View on journal
                      </a>
                    )}
                    <a className="btn btn-ghost btn-sm" href={`/archive?q=${encodeURIComponent(p.title)}`}>View in Archive</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

// === Editor workload =======================================================
function WorkloadCard() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.workload().then(setRows).catch(() => {});
  }, []);
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((e) => e.load));
  const top = rows.slice(0, 8);
  return (
    <Card className="dd-panel">
      <h3>Editor workload</h3>
      <p className="muted dd-panel-sub">Active papers per editor — spot anyone overloaded before reassigning.</p>
      <div className="stack">
        {top.map((e) => (
          <div key={e.id} className="dd-load-row">
            <span className="dd-load-name">
              {e.name} <span className="muted">{e.role}{e.category ? ` · ${e.category}` : ''}</span>
            </span>
            <span className="dd-load-bar">
              <span className="dd-load-fill" style={{ width: `${(e.load / max) * 100}%`, background: e.load >= 3 ? 'var(--danger, #e5484d)' : 'var(--brand, #4f7cff)' }} />
            </span>
            <span className="dd-load-num">{e.load}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// === Reassign a reviews editor =============================================
function ReassignCard({ onChanged }) {
  const [board, setBoard] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busyKey, setBusyKey] = useState('');

  const load = useCallback(() => {
    api.reassignBoard().then(setBoard).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const swap = async (paperId, fromEditorId, toEditorId) => {
    if (!toEditorId) return;
    setBusyKey(`${paperId}:${fromEditorId}`); setError(''); setStatus('');
    try {
      await api.reassign({ paperId, fromEditorId, toEditorId });
      setStatus('Reviewer reassigned.');
      load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyKey('');
    }
  };

  return (
    <Card className="dd-panel">
      <h3>Reassign a reviews editor</h3>
      <p className="muted dd-panel-sub">
        Swap an assigned reviewer (same category) while a paper is still in first-pass review. Any review they left is cleared.
      </p>
      {error && <div className="login-error">{error}</div>}
      {status && <p className="muted dd-ok">{status}</p>}
      {board.length === 0 ? (
        <p className="muted">No papers are in the reviews stage right now.</p>
      ) : (
        <div className="stack dd-reassign">
          {board.map((p) => (
            <div key={p.paperId} className="dd-reassign-row">
              <div className="dd-title">{p.title}</div>
              <div className="dd-id muted">{p.paperId} · {p.category}</div>
              {p.assigned.map((a) => (
                <div key={a.id} className="dd-reassign-slot">
                  <span>
                    {a.name} <span className="muted">({a.load} active){a.reviewed ? ' · already reviewed' : ''}</span>
                  </span>
                  {p.candidates.length > 0 ? (
                    <select
                      defaultValue=""
                      disabled={busyKey === `${p.paperId}:${a.id}`}
                      onChange={(e) => swap(p.paperId, a.id, e.target.value)}
                    >
                      <option value="" disabled>Swap to…</option>
                      {p.candidates.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.load})</option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">no spare reviewer</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// === Discord webhook =======================================================
function WebhookCard() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setUrl(s.discordWebhookUrl || '')).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true); setError(''); setStatus('');
    try { await api.setWebhook(url); setStatus('Saved.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setError(''); setStatus('');
    try { await api.setWebhook(url); await api.testWebhook(); setStatus('Test message sent — check your Discord channel.'); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="dd-panel">
      <div className="card-row">
        <h3>Discord queue notifications</h3>
        <Badge tone={url ? 'green' : 'gray'}>{url ? 'configured' : 'off'}</Badge>
      </div>
      <p className="muted dd-panel-sub">
        Post an embed to your channel every time a paper advances — or is declined or published — so the team watches the queue live.
      </p>
      {error && <div className="login-error">{error}</div>}
      <Field label="Discord webhook URL">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
      </Field>
      <div className="row">
        <Button onClick={save} disabled={busy} size="btn-sm">{busy ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" onClick={test} disabled={busy} size="btn-sm">Send test</Button>
        {status && <span className="muted">{status}</span>}
      </div>
      <p className="muted dd-hint">
        Discord → Channel settings → Integrations → Webhooks → New Webhook → Copy URL.
        Set <code>DISCORD_WEBHOOK_URL</code> on the backend to persist across restarts.
      </p>
    </Card>
  );
}

// === Page ==================================================================
export default function DirectorDashboard() {
  const toast = useToast();
  const [data, setData] = useState({ toEmail: [], toPublish: [], published: [] });
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  // Issue lifecycle: 'loading' → 'ready' (endpoints answered), 'absent'
  // (they 404 — the backend unit isn't merged yet; show the quiet note), or
  // 'error' (deployed but failing — show a retry instead of a wrong claim).
  const [journal, setJournal] = useState({ state: 'loading', meta: null, issues: [] });
  const journalSeq = useRef(0);
  // Publish confirmations from this session, keyed by paper id.
  const [lastPublished, setLastPublished] = useState({});

  const load = useCallback(() => {
    api.director()
      .then((d) => { setData({ toEmail: [], toPublish: [], published: [], ...d }); setLoaded(true); })
      .catch((e) => { setError(e.message); setLoaded(true); });
  }, []);
  // Live polling so papers appear as they move through the pipeline.
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const loadJournal = useCallback(() => {
    // GETs retry with backoff, so an old call can outlive a newer one — the
    // sequence check keeps a stale response from overwriting fresher state.
    const seq = ++journalSeq.current;
    Promise.all([api.journalMeta(), api.journalIssues()])
      .then(([meta, issues]) => {
        if (seq !== journalSeq.current) return;
        setJournal({ state: 'ready', meta, issues: Array.isArray(issues) ? issues : [] });
      })
      .catch((e) => {
        if (seq !== journalSeq.current) return;
        setJournal((j) => {
          if (j.state === 'ready') return j; // keep a working panel through one flaky refresh
          return e?.status === 404
            ? { state: 'absent', meta: null, issues: [] }
            : { state: 'error', meta: null, issues: [] };
        });
      });
  }, []);
  useEffect(() => { loadJournal(); }, [loadJournal]);

  const markEmailed = (paperId, at) =>
    api.markEmailed({ paperId, at }).then(load).catch((e) => setError(e.message));

  const publish = (paperId, opts = {}) =>
    api.publish({ paperId, ...opts })
      .then((pub) => {
        // Confirmation surface: toast now, inline row state once the row lands
        // in "Recently published" on reload.
        setLastPublished((m) => ({ ...m, [paperId]: pub || {} }));
        const where = pub?.volume != null && pub?.issue != null ? ` · ${issueLabel(pub.volume, pub.issue)}` : '';
        toast.success(`Published — DOI ${pub?.doi || 'assigned'}${where}`);
        load();
        // Deliberate re-probe even when 'absent': if the issue backend was
        // deployed mid-session this lights the panel up; otherwise it's one
        // cheap 404 and nothing changes.
        loadJournal();
      })
      .catch((e) => { setError(e.message); toast.error(e.message); });

  const pendingEmails = data.toEmail.filter((e) => !e.emailed).length;
  const journalMeta = journal.state === 'ready' ? journal.meta : null;
  // The single definition of "the open issue" — the issue panel and the
  // publish form both use this, so they can't disagree.
  const openIssue = useMemo(() => {
    if (journal.state !== 'ready') return null;
    const { meta, issues } = journal;
    return (
      issues.find((it) => it.status === 'open' && it.volume === meta?.currentVolume && it.issue === meta?.currentIssue) ||
      issues.find((it) => it.status === 'open') ||
      null
    );
  }, [journal]);

  return (
    <div className="dd">
      <h1 className="page-title">Director Desk</h1>
      <p className="page-sub">Email authors the outcome of every decision, publish accepted papers, and run the journal's issues.</p>

      <div className="dd-stats">
        <Stat label="emails to send" value={pendingEmails} tone={pendingEmails ? 'gold' : 'gray'} />
        <Stat label="ready to publish" value={data.toPublish.length} tone={data.toPublish.length ? 'gold' : 'gray'} />
        <Stat label="published" value={data.published.length} tone="green" />
      </div>

      {error && <div className="login-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <IssuesSection journal={journal} current={openIssue} onRefresh={loadJournal} />

      {loaded && (
        <>
          <EmailQueue rows={data.toEmail} onMarkEmailed={markEmailed} />
          <PublishQueue rows={data.toPublish} onPublish={publish} openIssue={openIssue} />
          <PublishedList rows={data.published} lastPublished={lastPublished} meta={journalMeta} />
        </>
      )}

      <h2 className="section-title dd-tools-head">Editorial controls</h2>
      <div className="grid grid-2 dd-panels">
        <WorkloadCard />
        <ReassignCard onChanged={load} />
        <WebhookCard />
      </div>
    </div>
  );
}
